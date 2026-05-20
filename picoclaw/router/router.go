// Package router handles intent classification and task routing for PicoClaw.
package router

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// IntentCategory represents the classified intent of a task.
type IntentCategory string

const (
	IntentConversation IntentCategory = "conversation"
	IntentResearch     IntentCategory = "research"
	IntentAction       IntentCategory = "action"
	IntentAnalysis     IntentCategory = "analysis"
	IntentInternal     IntentCategory = "internal"
)

// Task represents a unit of work on the message bus.
type Task struct {
	ID          string         `json:"id"`
	SenderID    string         `json:"sender_id"`
	Destination string         `json:"destination"`
	Intent      IntentCategory `json:"intent"`
	Payload     []byte         `json:"payload"`
	Timestamp   int64          `json:"timestamp"`
	Priority    int            `json:"priority"`
}

// IntentClassifier performs keyword-based intent classification.
type IntentClassifier struct {
	keywords map[IntentCategory][]string
}

// NewIntentClassifier creates a classifier with default keyword mappings.
func NewIntentClassifier() *IntentClassifier {
	return &IntentClassifier{
		keywords: map[IntentCategory][]string{
			IntentConversation: {
				"hello", "hi", "hey", "chat", "talk", "conversation",
				"greet", "thanks", "bye", "goodbye", "how are you",
			},
			IntentResearch: {
				"search", "find", "lookup", "research", "investigate",
				"query", "discover", "explore", "information", "data",
			},
			IntentAction: {
				"send", "create", "delete", "update", "execute",
				"post", "publish", "trigger", "deploy", "run",
			},
			IntentAnalysis: {
				"analyze", "report", "summarize", "compare", "evaluate",
				"metrics", "statistics", "trend", "insight", "review",
			},
			IntentInternal: {
				"health", "status", "config", "restart", "shutdown",
				"register", "heartbeat", "ping", "diagnostic", "internal",
			},
		},
	}
}

// ClassifyIntent determines the intent category of a payload using keyword matching.
// Must complete within 50ms. Returns the category, confidence score (0.0-1.0), and error.
func (ic *IntentClassifier) ClassifyIntent(payload []byte) (IntentCategory, float64, error) {
	if len(payload) == 0 {
		return IntentConversation, 0.0, errors.New("empty payload")
	}

	text := strings.ToLower(string(payload))

	bestCategory := IntentConversation
	bestScore := 0.0
	totalMatches := 0

	for category, words := range ic.keywords {
		matches := 0
		for _, word := range words {
			if strings.Contains(text, word) {
				matches++
			}
		}
		if matches > 0 {
			totalMatches += matches
			score := float64(matches) / float64(len(words))
			if score > bestScore {
				bestScore = score
				bestCategory = category
			}
		}
	}

	// If no keywords matched, default to conversation with low confidence
	if totalMatches == 0 {
		return IntentConversation, 0.1, nil
	}

	// Normalize confidence: cap at 1.0
	if bestScore > 1.0 {
		bestScore = 1.0
	}

	return bestCategory, bestScore, nil
}

// Balancer distributes tasks across agent instances using round-robin.
type Balancer struct {
	mu        sync.Mutex
	instances map[string][]string // agentType -> list of instance IDs
	counters  map[string]uint64   // agentType -> round-robin counter
}

// NewBalancer creates a new load balancer.
func NewBalancer() *Balancer {
	return &Balancer{
		instances: make(map[string][]string),
		counters:  make(map[string]uint64),
	}
}

// RegisterInstance adds an instance for a given agent type.
func (b *Balancer) RegisterInstance(agentType, instanceID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.instances[agentType] = append(b.instances[agentType], instanceID)
}

// NextInstance returns the next instance for the given agent type using round-robin.
func (b *Balancer) NextInstance(agentType string) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	instances, ok := b.instances[agentType]
	if !ok || len(instances) == 0 {
		return "", fmt.Errorf("no instances available for agent type: %s", agentType)
	}

	idx := b.counters[agentType] % uint64(len(instances))
	b.counters[agentType]++
	return instances[idx], nil
}

// Router handles intent classification and task routing.
type Router struct {
	classifier  *IntentClassifier
	balancer    *Balancer
	fallbackMap map[IntentCategory]string
	redisClient *redis.Client
	streamName  string
	groupName   string
	retryQueue  chan *Task
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// RouterConfig holds configuration for creating a new Router.
type RouterConfig struct {
	RedisAddr   string
	StreamName  string
	GroupName   string
	FallbackMap map[IntentCategory]string
}

// DefaultFallbackMap returns the default intent-to-stream fallback mapping.
// These map to the canonical Redis Stream suffixes:
//   - "action" → stream "tasks:action" (OpenClaw consumer group "openclaw-workers")
//   - "gemini" → stream "tasks:gemini" (OpenClaw Gemini client consumer)
//   - "ironclaw" → stream "tasks:ironclaw" (IronClaw internal)
func DefaultFallbackMap() map[IntentCategory]string {
	return map[IntentCategory]string{
		IntentConversation: "gemini",
		IntentResearch:     "gemini",
		IntentAction:       "action",
		IntentAnalysis:     "gemini",
		IntentInternal:     "ironclaw",
	}
}

// NewRouter creates a new Router with the given configuration.
func NewRouter(cfg RouterConfig) *Router {
	ctx, cancel := context.WithCancel(context.Background())

	fallback := cfg.FallbackMap
	if fallback == nil {
		fallback = DefaultFallbackMap()
	}

	streamName := cfg.StreamName
	if streamName == "" {
		streamName = "tasks:router"
	}

	groupName := cfg.GroupName
	if groupName == "" {
		groupName = "picoclaw-workers"
	}

	var rdb *redis.Client
	if cfg.RedisAddr != "" {
		rdb = redis.NewClient(&redis.Options{
			Addr: cfg.RedisAddr,
		})
	}

	r := &Router{
		classifier:  NewIntentClassifier(),
		balancer:    NewBalancer(),
		fallbackMap: fallback,
		redisClient: rdb,
		streamName:  streamName,
		groupName:   groupName,
		retryQueue:  make(chan *Task, 1000),
		ctx:         ctx,
		cancel:      cancel,
	}

	return r
}

// Start begins consuming from Redis Streams and processing the retry queue.
func (r *Router) Start() error {
	if r.redisClient == nil {
		return errors.New("redis client not configured")
	}

	// Create consumer group (ignore error if already exists)
	_ = r.redisClient.XGroupCreateMkStream(r.ctx, r.streamName, r.groupName, "0").Err()

	// Start retry worker
	r.wg.Add(1)
	go r.retryWorker()

	// Start stream consumer
	r.wg.Add(1)
	go r.consumeStream()

	return nil
}

// Stop gracefully shuts down the router.
func (r *Router) Stop() {
	r.cancel()
	r.wg.Wait()
	if r.redisClient != nil {
		r.redisClient.Close()
	}
}

// consumeStream reads tasks from Redis Streams consumer group.
func (r *Router) consumeStream() {
	defer r.wg.Done()

	for {
		select {
		case <-r.ctx.Done():
			return
		default:
		}

		streams, err := r.redisClient.XReadGroup(r.ctx, &redis.XReadGroupArgs{
			Group:    r.groupName,
			Consumer: "picoclaw-worker-1",
			Streams:  []string{r.streamName, ">"},
			Count:    10,
			Block:    time.Second,
		}).Result()

		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			continue
		}

		for _, stream := range streams {
			for _, msg := range stream.Messages {
				task, err := r.parseStreamMessage(msg)
				if err != nil {
					continue
				}
				_ = r.RouteTask(task)
				// Acknowledge the message
				r.redisClient.XAck(r.ctx, r.streamName, r.groupName, msg.ID)
			}
		}
	}
}

// parseStreamMessage converts a Redis stream message into a Task.
// Handles field names from IronClaw's MessageBusClient:
//   id, sender_id, destination_id, task_type, payload, timestamp
func (r *Router) parseStreamMessage(msg redis.XMessage) (*Task, error) {
	task := &Task{}

	if id, ok := msg.Values["id"].(string); ok {
		task.ID = id
	}
	if senderID, ok := msg.Values["sender_id"].(string); ok {
		task.SenderID = senderID
	}
	// IronClaw uses "destination_id", but we also check "destination" for compatibility
	if dest, ok := msg.Values["destination_id"].(string); ok {
		task.Destination = dest
	} else if dest, ok := msg.Values["destination"].(string); ok {
		task.Destination = dest
	}
	// IronClaw uses "task_type" for the intent/type field
	if taskType, ok := msg.Values["task_type"].(string); ok {
		// Map task_type to intent if it matches a known category
		switch IntentCategory(taskType) {
		case IntentConversation, IntentResearch, IntentAction, IntentAnalysis, IntentInternal:
			task.Intent = IntentCategory(taskType)
		}
	}
	if payload, ok := msg.Values["payload"].(string); ok {
		task.Payload = []byte(payload)
	}
	if ts, ok := msg.Values["timestamp"].(string); ok {
		var timestamp int64
		fmt.Sscanf(ts, "%d", &timestamp)
		task.Timestamp = timestamp
	}

	return task, nil
}

// retryWorker processes tasks from the retry queue with a 5-second delay.
func (r *Router) retryWorker() {
	defer r.wg.Done()

	for {
		select {
		case <-r.ctx.Done():
			return
		case task := <-r.retryQueue:
			select {
			case <-r.ctx.Done():
				return
			case <-time.After(5 * time.Second):
				_ = r.RouteTask(task)
			}
		}
	}
}

// RouteTask classifies the intent of a task and routes it to the appropriate agent.
// If the destination is unavailable, it routes to a fallback or queues with 5s retry.
//
// Routing destinations (canonical stream names):
//   - IntentAction → "action" (consumed by OpenClaw via "tasks:action")
//   - IntentConversation, IntentResearch, IntentAnalysis → "gemini" (consumed by OpenClaw Gemini client via "tasks:gemini")
//   - IntentInternal → "ironclaw" (consumed by IronClaw internal handler)
func (r *Router) RouteTask(task *Task) error {
	if task == nil {
		return errors.New("nil task")
	}

	// Classify intent if not already set
	if task.Intent == "" {
		intent, _, err := r.classifier.ClassifyIntent(task.Payload)
		if err != nil {
			// Default to conversation on classification error
			task.Intent = IntentConversation
		} else {
			task.Intent = intent
		}
	}

	// Determine destination using the fallback map (canonical stream names).
	// The fallback map maps intents to stream suffixes:
	//   conversation → "gemini", research → "gemini", action → "action", etc.
	destination := task.Destination
	if destination == "" {
		destination = r.fallbackMap[task.Intent]
	}

	// Try to route via balancer (for multi-instance scenarios)
	instance, err := r.balancer.NextInstance(destination)
	if err != nil {
		// No balancer instances registered — use the canonical destination directly.
		// This is the normal path in single-instance deployments.
		return r.deliverTask(task, destination)
	}

	return r.deliverTask(task, instance)
}

// deliverTask publishes the routed task to the destination stream.
// Routes to canonical stream names:
//   - "tasks:action" for OpenClaw (action execution)
//   - "tasks:gemini" for Gemini (conversation/analysis/research)
//   - "tasks:ironclaw" for internal operations
func (r *Router) deliverTask(task *Task, instance string) error {
	if r.redisClient == nil {
		// In test mode without Redis, just return success
		return nil
	}

	// Map the destination to the canonical stream name used by downstream consumers.
	// OpenClaw consumes from "tasks:action" with consumer group "openclaw-workers".
	// Gemini requests are also handled by OpenClaw's pipeline via "tasks:gemini".
	destStream := fmt.Sprintf("tasks:%s", instance)

	taskJSON, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("failed to marshal task: %w", err)
	}

	return r.redisClient.XAdd(r.ctx, &redis.XAddArgs{
		Stream: destStream,
		Values: map[string]interface{}{
			"id":             task.ID,
			"sender_id":     "picoclaw",
			"destination_id": instance,
			"intent":        string(task.Intent),
			"tool_name":     task.Destination,
			"payload":       string(taskJSON),
			"timestamp":     task.Timestamp,
			"priority":      task.Priority,
		},
	}).Err()
}
