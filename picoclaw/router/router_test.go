package router

import (
	"testing"
	"time"
)

// --- IntentClassifier Tests ---

func TestClassifyIntent_Conversation(t *testing.T) {
	ic := NewIntentClassifier()

	tests := []struct {
		name    string
		payload string
		want    IntentCategory
	}{
		{"hello greeting", "hello, how are you?", IntentConversation},
		{"hi greeting", "hi there", IntentConversation},
		{"chat keyword", "let's chat about something", IntentConversation},
		{"thanks", "thanks for the help", IntentConversation},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, confidence, err := ic.ClassifyIntent([]byte(tt.payload))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("ClassifyIntent(%q) = %v, want %v", tt.payload, got, tt.want)
			}
			if confidence <= 0 {
				t.Errorf("expected positive confidence, got %f", confidence)
			}
		})
	}
}

func TestClassifyIntent_Research(t *testing.T) {
	ic := NewIntentClassifier()

	tests := []struct {
		name    string
		payload string
		want    IntentCategory
	}{
		{"search keyword", "search for recent news", IntentResearch},
		{"find keyword", "find information about Go", IntentResearch},
		{"research keyword", "research this topic thoroughly", IntentResearch},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _, err := ic.ClassifyIntent([]byte(tt.payload))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("ClassifyIntent(%q) = %v, want %v", tt.payload, got, tt.want)
			}
		})
	}
}

func TestClassifyIntent_Action(t *testing.T) {
	ic := NewIntentClassifier()

	tests := []struct {
		name    string
		payload string
		want    IntentCategory
	}{
		{"send keyword", "send an email to the team", IntentAction},
		{"create keyword", "create a new document", IntentAction},
		{"deploy keyword", "deploy the application now", IntentAction},
		{"execute keyword", "execute the script", IntentAction},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _, err := ic.ClassifyIntent([]byte(tt.payload))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("ClassifyIntent(%q) = %v, want %v", tt.payload, got, tt.want)
			}
		})
	}
}

func TestClassifyIntent_Analysis(t *testing.T) {
	ic := NewIntentClassifier()

	tests := []struct {
		name    string
		payload string
		want    IntentCategory
	}{
		{"analyze keyword", "analyze and summarize the sales figures", IntentAnalysis},
		{"report keyword", "generate a report on metrics", IntentAnalysis},
		{"summarize keyword", "summarize the meeting notes", IntentAnalysis},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _, err := ic.ClassifyIntent([]byte(tt.payload))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("ClassifyIntent(%q) = %v, want %v", tt.payload, got, tt.want)
			}
		})
	}
}

func TestClassifyIntent_Internal(t *testing.T) {
	ic := NewIntentClassifier()

	tests := []struct {
		name    string
		payload string
		want    IntentCategory
	}{
		{"health keyword", "health check status", IntentInternal},
		{"restart keyword", "restart the agent", IntentInternal},
		{"config keyword", "config diagnostic internal check", IntentInternal},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _, err := ic.ClassifyIntent([]byte(tt.payload))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("ClassifyIntent(%q) = %v, want %v", tt.payload, got, tt.want)
			}
		})
	}
}

func TestClassifyIntent_EmptyPayload(t *testing.T) {
	ic := NewIntentClassifier()

	_, _, err := ic.ClassifyIntent([]byte{})
	if err == nil {
		t.Error("expected error for empty payload, got nil")
	}
}

func TestClassifyIntent_NoKeywordsMatch(t *testing.T) {
	ic := NewIntentClassifier()

	got, confidence, err := ic.ClassifyIntent([]byte("xyzzy foobar baz"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should default to conversation with low confidence
	if got != IntentConversation {
		t.Errorf("expected IntentConversation for unknown text, got %v", got)
	}
	if confidence > 0.2 {
		t.Errorf("expected low confidence for unknown text, got %f", confidence)
	}
}

func TestClassifyIntent_Within50ms(t *testing.T) {
	ic := NewIntentClassifier()
	payload := []byte("please search for information and analyze the data then send a report")

	start := time.Now()
	_, _, err := ic.ClassifyIntent(payload)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if elapsed > 50*time.Millisecond {
		t.Errorf("ClassifyIntent took %v, must complete within 50ms", elapsed)
	}
}

func TestClassifyIntent_CaseInsensitive(t *testing.T) {
	ic := NewIntentClassifier()

	got, _, err := ic.ClassifyIntent([]byte("SEARCH for DATA"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != IntentResearch {
		t.Errorf("expected IntentResearch for uppercase keywords, got %v", got)
	}
}

// --- Balancer Tests ---

func TestBalancer_RoundRobin(t *testing.T) {
	b := NewBalancer()
	b.RegisterInstance("gemini", "gemini-1")
	b.RegisterInstance("gemini", "gemini-2")
	b.RegisterInstance("gemini", "gemini-3")

	expected := []string{"gemini-1", "gemini-2", "gemini-3", "gemini-1", "gemini-2", "gemini-3"}
	for i, want := range expected {
		got, err := b.NextInstance("gemini")
		if err != nil {
			t.Fatalf("iteration %d: unexpected error: %v", i, err)
		}
		if got != want {
			t.Errorf("iteration %d: got %s, want %s", i, got, want)
		}
	}
}

func TestBalancer_NoInstances(t *testing.T) {
	b := NewBalancer()

	_, err := b.NextInstance("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent agent type, got nil")
	}
}

func TestBalancer_SingleInstance(t *testing.T) {
	b := NewBalancer()
	b.RegisterInstance("openclaw", "openclaw-1")

	for i := 0; i < 5; i++ {
		got, err := b.NextInstance("openclaw")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "openclaw-1" {
			t.Errorf("expected openclaw-1, got %s", got)
		}
	}
}

// --- Router Tests ---

func TestRouteTask_ClassifiesAndRoutes(t *testing.T) {
	r := NewRouter(RouterConfig{
		FallbackMap: DefaultFallbackMap(),
	})
	// Register instances so routing succeeds
	r.balancer.RegisterInstance("gemini", "gemini-1")
	r.balancer.RegisterInstance("openclaw", "openclaw-1")
	r.balancer.RegisterInstance("ironclaw", "ironclaw-1")

	task := &Task{
		ID:       "task-1",
		SenderID: "user-1",
		Payload:  []byte("send an email to the team"),
	}

	err := r.RouteTask(task)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if task.Intent != IntentAction {
		t.Errorf("expected IntentAction, got %v", task.Intent)
	}
}

func TestRouteTask_UsesExplicitDestination(t *testing.T) {
	r := NewRouter(RouterConfig{
		FallbackMap: DefaultFallbackMap(),
	})
	r.balancer.RegisterInstance("openclaw", "openclaw-1")

	task := &Task{
		ID:          "task-2",
		SenderID:    "user-1",
		Destination: "openclaw",
		Payload:     []byte("hello there"),
	}

	err := r.RouteTask(task)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRouteTask_FallbackWhenDestinationUnavailable(t *testing.T) {
	r := NewRouter(RouterConfig{
		FallbackMap: DefaultFallbackMap(),
	})
	// Register fallback instance but not the explicit destination
	r.balancer.RegisterInstance("gemini", "gemini-1")

	task := &Task{
		ID:          "task-3",
		SenderID:    "user-1",
		Destination: "unavailable-agent",
		Intent:      IntentConversation,
		Payload:     []byte("hello"),
	}

	err := r.RouteTask(task)
	// Should succeed by routing to fallback (gemini) or queuing for retry
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRouteTask_QueuesForRetryWhenAllUnavailable(t *testing.T) {
	r := NewRouter(RouterConfig{
		FallbackMap: DefaultFallbackMap(),
	})
	// No instances registered at all

	task := &Task{
		ID:       "task-4",
		SenderID: "user-1",
		Payload:  []byte("do something"),
	}

	err := r.RouteTask(task)
	// Should queue for retry (no error since retry queue accepts it)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRouteTask_NilTask(t *testing.T) {
	r := NewRouter(RouterConfig{
		FallbackMap: DefaultFallbackMap(),
	})

	err := r.RouteTask(nil)
	if err == nil {
		t.Error("expected error for nil task, got nil")
	}
}

func TestRouteTask_PresetIntent(t *testing.T) {
	r := NewRouter(RouterConfig{
		FallbackMap: DefaultFallbackMap(),
	})
	r.balancer.RegisterInstance("openclaw", "openclaw-1")

	task := &Task{
		ID:       "task-5",
		SenderID: "user-1",
		Intent:   IntentAction,
		Payload:  []byte("random text without action keywords"),
	}

	err := r.RouteTask(task)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Intent should remain as preset
	if task.Intent != IntentAction {
		t.Errorf("expected preset IntentAction to be preserved, got %v", task.Intent)
	}
}

func TestDefaultFallbackMap(t *testing.T) {
	fm := DefaultFallbackMap()

	expected := map[IntentCategory]string{
		IntentConversation: "gemini",
		IntentResearch:     "gemini",
		IntentAction:       "openclaw",
		IntentAnalysis:     "gemini",
		IntentInternal:     "ironclaw",
	}

	for cat, want := range expected {
		got, ok := fm[cat]
		if !ok {
			t.Errorf("missing fallback for %v", cat)
			continue
		}
		if got != want {
			t.Errorf("fallback for %v = %s, want %s", cat, got, want)
		}
	}
}

func TestNewRouter_DefaultConfig(t *testing.T) {
	r := NewRouter(RouterConfig{})

	if r.classifier == nil {
		t.Error("classifier should not be nil")
	}
	if r.balancer == nil {
		t.Error("balancer should not be nil")
	}
	if r.streamName != "tasks:router" {
		t.Errorf("expected default stream name 'tasks:router', got %s", r.streamName)
	}
	if r.groupName != "picoclaw-workers" {
		t.Errorf("expected default group name 'picoclaw-workers', got %s", r.groupName)
	}
	if len(r.fallbackMap) == 0 {
		t.Error("fallback map should not be empty")
	}
}
