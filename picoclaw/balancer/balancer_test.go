package balancer

import (
	"testing"
	"time"
)

func TestNextInstance_RoundRobinDistribution(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: true, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "b", Type: "worker", Healthy: true, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "c", Type: "worker", Healthy: true, LastSeen: now})

	counts := map[string]int{"a": 0, "b": 0, "c": 0}
	totalTasks := 9

	for i := 0; i < totalTasks; i++ {
		inst, err := lb.NextInstance("worker")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		counts[inst.ID]++
	}

	// With 9 tasks and 3 instances, each should get exactly 3.
	for id, count := range counts {
		if count != 3 {
			t.Errorf("instance %s got %d tasks, expected 3", id, count)
		}
	}
}

func TestNextInstance_SkipsUnhealthyInstances(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: true, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "b", Type: "worker", Healthy: false, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "c", Type: "worker", Healthy: true, LastSeen: now})

	// All tasks should go to healthy instances only (a and c).
	counts := map[string]int{}
	totalTasks := 6

	for i := 0; i < totalTasks; i++ {
		inst, err := lb.NextInstance("worker")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inst.ID == "b" {
			t.Fatal("unhealthy instance 'b' should never be selected")
		}
		counts[inst.ID]++
	}

	// Only healthy instances should receive tasks.
	if counts["a"] == 0 || counts["c"] == 0 {
		t.Errorf("expected both healthy instances to receive tasks, got a=%d c=%d", counts["a"], counts["c"])
	}
}

func TestNextInstance_EmptyInstancesError(t *testing.T) {
	lb := NewLoadBalancer()

	// No instances registered for this type.
	_, err := lb.NextInstance("nonexistent")
	if err != ErrNoHealthyInstances {
		t.Errorf("expected ErrNoHealthyInstances, got %v", err)
	}
}

func TestNextInstance_AllUnhealthyReturnsError(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: false, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "b", Type: "worker", Healthy: false, LastSeen: now})

	_, err := lb.NextInstance("worker")
	if err != ErrNoHealthyInstances {
		t.Errorf("expected ErrNoHealthyInstances when all unhealthy, got %v", err)
	}
}

func TestRegisterInstance(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: true, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "b", Type: "worker", Healthy: true, LastSeen: now})

	if count := lb.HealthyCount("worker"); count != 2 {
		t.Errorf("expected 2 healthy instances, got %d", count)
	}
}

func TestRemoveInstance(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: true, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "b", Type: "worker", Healthy: true, LastSeen: now})

	lb.RemoveInstance("worker", "a")

	if count := lb.HealthyCount("worker"); count != 1 {
		t.Errorf("expected 1 healthy instance after removal, got %d", count)
	}

	// The remaining instance should be "b".
	inst, err := lb.NextInstance("worker")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if inst.ID != "b" {
		t.Errorf("expected instance 'b', got '%s'", inst.ID)
	}
}

func TestRemoveInstance_NonexistentType(t *testing.T) {
	lb := NewLoadBalancer()

	// Should not panic when removing from a nonexistent type.
	lb.RemoveInstance("nonexistent", "a")
}

func TestRemoveInstance_NonexistentID(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: true, LastSeen: now})

	// Should not panic or remove anything when ID doesn't exist.
	lb.RemoveInstance("worker", "z")

	if count := lb.HealthyCount("worker"); count != 1 {
		t.Errorf("expected 1 healthy instance, got %d", count)
	}
}

func TestHealthyCount(t *testing.T) {
	lb := NewLoadBalancer()

	now := time.Now().Unix()
	lb.RegisterInstance("worker", AgentInstance{ID: "a", Type: "worker", Healthy: true, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "b", Type: "worker", Healthy: false, LastSeen: now})
	lb.RegisterInstance("worker", AgentInstance{ID: "c", Type: "worker", Healthy: true, LastSeen: now})

	if count := lb.HealthyCount("worker"); count != 2 {
		t.Errorf("expected 2 healthy instances, got %d", count)
	}

	if count := lb.HealthyCount("nonexistent"); count != 0 {
		t.Errorf("expected 0 for nonexistent type, got %d", count)
	}
}
