// Package balancer provides round-robin load balancing across agent instances.
package balancer

import (
	"errors"
	"sync"
	"sync/atomic"
)

// ErrNoHealthyInstances is returned when no healthy instances are available for routing.
var ErrNoHealthyInstances = errors.New("no healthy instances available")

// AgentInstance represents a running agent that can receive tasks.
type AgentInstance struct {
	ID       string
	Type     string
	Healthy  bool
	LastSeen int64
}

// LoadBalancer distributes tasks across agent instances using round-robin.
type LoadBalancer struct {
	mu        sync.RWMutex
	instances map[string][]AgentInstance
	counters  map[string]*atomic.Uint64
}

// NewLoadBalancer creates a new LoadBalancer with initialized maps.
func NewLoadBalancer() *LoadBalancer {
	return &LoadBalancer{
		instances: make(map[string][]AgentInstance),
		counters:  make(map[string]*atomic.Uint64),
	}
}

// RegisterInstance adds an agent instance to the pool for the given agent type.
func (lb *LoadBalancer) RegisterInstance(agentType string, instance AgentInstance) {
	lb.mu.Lock()
	defer lb.mu.Unlock()

	if _, exists := lb.counters[agentType]; !exists {
		lb.counters[agentType] = &atomic.Uint64{}
	}
	lb.instances[agentType] = append(lb.instances[agentType], instance)
}

// RemoveInstance removes an agent instance by ID from the given agent type pool.
func (lb *LoadBalancer) RemoveInstance(agentType string, instanceID string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()

	instances, exists := lb.instances[agentType]
	if !exists {
		return
	}

	for i, inst := range instances {
		if inst.ID == instanceID {
			lb.instances[agentType] = append(instances[:i], instances[i+1:]...)
			return
		}
	}
}

// NextInstance returns the next healthy agent instance using round-robin distribution.
// It skips unhealthy instances. Returns an error if no healthy instances are available.
func (lb *LoadBalancer) NextInstance(agentType string) (*AgentInstance, error) {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	instances, exists := lb.instances[agentType]
	if !exists || len(instances) == 0 {
		return nil, ErrNoHealthyInstances
	}

	n := uint64(len(instances))
	counter := lb.counters[agentType]

	// Try all instances starting from the current counter position.
	// If we cycle through all without finding a healthy one, return error.
	for range instances {
		idx := counter.Add(1) - 1
		candidate := &instances[idx%n]
		if candidate.Healthy {
			return candidate, nil
		}
	}

	return nil, ErrNoHealthyInstances
}

// HealthyCount returns the number of healthy instances for the given agent type.
func (lb *LoadBalancer) HealthyCount(agentType string) int {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	instances, exists := lb.instances[agentType]
	if !exists {
		return 0
	}

	count := 0
	for _, inst := range instances {
		if inst.Healthy {
			count++
		}
	}
	return count
}
