//! WASM Sandbox Manager — agent isolation via wasmtime.
//!
//! Each agent runs in its own WASM sandbox with:
//! - Fuel metering for CPU budgets (Requirement 1.4)
//! - Epoch-based interruption for timeouts (Requirement 1.4)
//! - Linear memory caps for memory isolation (Requirement 1.2)
//! - Complete isolation: each sandbox gets its own Engine, Store, Instance (Requirement 1.1)

use crate::types::AgentId;
use std::sync::Arc;
use thiserror::Error;
use wasmtime::{Engine, Instance, Linker, Memory, Module, Store};

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during sandbox creation.
#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("failed to create wasmtime engine: {0}")]
    EngineCreation(String),

    #[error("failed to compile WASM module: {0}")]
    ModuleCompilation(String),

    #[error("failed to instantiate WASM module: {0}")]
    Instantiation(String),

    #[error("invalid sandbox configuration: {0}")]
    InvalidConfig(String),
}

/// Errors that can occur during sandbox execution.
#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("function '{0}' not found in WASM module")]
    FunctionNotFound(String),

    #[error("execution ran out of fuel (CPU budget exhausted)")]
    FuelExhausted,

    #[error("execution interrupted by epoch deadline (timeout)")]
    EpochDeadline,

    #[error("memory limit exceeded")]
    MemoryLimitExceeded,

    #[error("host call limit exceeded (max: {0})")]
    HostCallLimitExceeded(u32),

    #[error("execution trapped: {0}")]
    Trap(String),

    #[error("sandbox has been terminated")]
    Terminated,
}

// =============================================================================
// Configuration
// =============================================================================

/// Resource limits for a WASM sandbox.
///
/// Configures the maximum resources an agent can consume within its sandbox.
/// These limits are enforced by wasmtime's built-in metering mechanisms.
#[derive(Debug, Clone)]
pub struct SandboxConfig {
    /// Maximum linear memory in megabytes.
    pub max_memory_mb: u32,
    /// CPU budget expressed as millicores (informational, mapped to fuel).
    pub max_cpu_millicores: u32,
    /// Wasmtime fuel units available per execution call.
    pub fuel_limit: u64,
    /// Maximum epoch ticks before the sandbox is interrupted.
    pub epoch_deadline: u64,
    /// Maximum number of host function calls allowed per execution.
    pub max_host_calls: u32,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            max_memory_mb: 128,
            max_cpu_millicores: 500,
            fuel_limit: 1_000_000,
            epoch_deadline: 100,
            max_host_calls: 1000,
        }
    }
}

impl SandboxConfig {
    /// Validate the configuration values.
    pub fn validate(&self) -> Result<(), SandboxError> {
        if self.max_memory_mb == 0 {
            return Err(SandboxError::InvalidConfig(
                "max_memory_mb must be greater than 0".to_string(),
            ));
        }
        if self.fuel_limit == 0 {
            return Err(SandboxError::InvalidConfig(
                "fuel_limit must be greater than 0".to_string(),
            ));
        }
        if self.epoch_deadline == 0 {
            return Err(SandboxError::InvalidConfig(
                "epoch_deadline must be greater than 0".to_string(),
            ));
        }
        Ok(())
    }

    /// Convert max_memory_mb to bytes.
    pub fn max_memory_bytes(&self) -> usize {
        self.max_memory_mb as usize * 1024 * 1024
    }
}

// =============================================================================
// Sandbox State
// =============================================================================

/// Internal state tracked per wasmtime Store.
///
/// This state is accessible from host functions and tracks resource consumption
/// for the sandbox during execution.
pub struct SandboxState {
    /// Total fuel consumed across all executions.
    pub fuel_consumed: u64,
    /// Current memory usage in bytes (tracked from linear memory).
    pub memory_used_bytes: usize,
    /// Number of host function calls made during current execution.
    pub host_calls_count: u32,
    /// Maximum allowed host calls (from config).
    pub max_host_calls: u32,
    /// Whether the sandbox has been terminated.
    pub terminated: bool,
}

impl SandboxState {
    fn new(max_host_calls: u32) -> Self {
        Self {
            fuel_consumed: 0,
            memory_used_bytes: 0,
            host_calls_count: 0,
            max_host_calls,
            terminated: false,
        }
    }

    /// Check if host call limit has been reached.
    pub fn can_make_host_call(&self) -> bool {
        self.host_calls_count < self.max_host_calls
    }

    /// Increment host call counter. Returns error if limit exceeded.
    pub fn record_host_call(&mut self) -> Result<(), ExecutionError> {
        if !self.can_make_host_call() {
            return Err(ExecutionError::HostCallLimitExceeded(self.max_host_calls));
        }
        self.host_calls_count += 1;
        Ok(())
    }
}

// =============================================================================
// Resource Usage
// =============================================================================

/// Current resource usage snapshot for a sandbox.
#[derive(Debug, Clone)]
pub struct ResourceUsage {
    /// Total fuel consumed across all executions.
    pub fuel_consumed: u64,
    /// Current linear memory usage in bytes.
    pub memory_used_bytes: usize,
    /// Total host function calls made.
    pub host_calls_count: u32,
    /// Whether the sandbox is still active (not terminated).
    pub active: bool,
}

// =============================================================================
// WASM Sandbox
// =============================================================================

/// A running WASM sandbox instance providing complete isolation for an agent.
///
/// Each sandbox has its own wasmtime Engine, Store, and Instance, ensuring
/// that agents cannot interfere with each other's execution or memory.
///
/// # Resource Enforcement
///
/// - **CPU**: Fuel metering limits total instructions executed per call.
/// - **Time**: Epoch-based interruption provides wall-clock timeout.
/// - **Memory**: Linear memory is capped at `max_memory_mb`.
/// - **Host calls**: A counter limits interactions with host functions.
pub struct WasmSandbox {
    /// The agent that owns this sandbox.
    pub agent_id: AgentId,
    /// The configuration used to create this sandbox.
    pub config: SandboxConfig,
    /// The wasmtime engine (owns compilation state, one per sandbox for isolation).
    engine: Arc<Engine>,
    /// The wasmtime store (owns runtime state and fuel tracking).
    store: Store<SandboxState>,
    /// The instantiated WASM module.
    instance: Instance,
}

impl std::fmt::Debug for WasmSandbox {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WasmSandbox")
            .field("agent_id", &self.agent_id)
            .field("config", &self.config)
            .field("terminated", &self.store.data().terminated)
            .finish_non_exhaustive()
    }
}

impl WasmSandbox {
    /// Create a new sandbox with the given config.
    ///
    /// Provisions a wasmtime Engine with fuel metering and epoch interruption,
    /// compiles the WASM module, and instantiates it with resource limits.
    ///
    /// # Arguments
    ///
    /// * `agent_id` - Unique identifier for the agent owning this sandbox.
    /// * `wasm_module` - Raw WASM bytecode to compile and instantiate.
    /// * `config` - Resource limits to enforce.
    ///
    /// # Errors
    ///
    /// Returns `SandboxError` if configuration is invalid, compilation fails,
    /// or instantiation fails.
    pub fn new(
        agent_id: AgentId,
        wasm_module: &[u8],
        config: SandboxConfig,
    ) -> Result<Self, SandboxError> {
        config.validate()?;

        // Configure the engine with fuel metering and epoch interruption.
        let mut engine_config = wasmtime::Config::new();
        engine_config.consume_fuel(true);
        engine_config.epoch_interruption(true);

        let engine = Engine::new(&engine_config)
            .map_err(|e| SandboxError::EngineCreation(e.to_string()))?;

        let engine = Arc::new(engine);

        // Create the store with sandbox state and fuel.
        let mut store = Store::new(&engine, SandboxState::new(config.max_host_calls));

        // Add initial fuel budget.
        store
            .set_fuel(config.fuel_limit)
            .map_err(|e| SandboxError::EngineCreation(format!("failed to set fuel: {e}")))?;

        // Set epoch deadline for timeout enforcement.
        store.epoch_deadline_trap();
        store.set_epoch_deadline(config.epoch_deadline);

        // Compile the WASM module.
        let module = Module::new(&engine, wasm_module)
            .map_err(|e| SandboxError::ModuleCompilation(e.to_string()))?;

        // Create a linker with memory limits.
        let mut linker = Linker::new(&engine);

        // Define memory with the configured cap.
        // Memory limits: min 1 page (64KB = 65536 bytes), max based on config.
        const WASM_PAGE_SIZE: usize = 65536;
        let max_pages = (config.max_memory_bytes() / WASM_PAGE_SIZE) as u32;
        let memory_type = wasmtime::MemoryType::new(1, Some(max_pages));
        let memory = Memory::new(&mut store, memory_type)
            .map_err(|e| SandboxError::Instantiation(format!("failed to create memory: {e}")))?;

        linker
            .define(&store, "env", "memory", memory)
            .map_err(|e| SandboxError::Instantiation(format!("failed to define memory: {e}")))?;

        // Instantiate the module.
        let instance = linker
            .instantiate(&mut store, &module)
            .map_err(|e| SandboxError::Instantiation(e.to_string()))?;

        Ok(Self {
            agent_id,
            config,
            engine,
            store,
            instance,
        })
    }

    /// Execute a function within the sandbox with resource limits enforced.
    ///
    /// Resets per-execution counters (host calls), refuels the store, and
    /// invokes the named exported function. The function receives input bytes
    /// via a pointer/length pair and returns output bytes.
    ///
    /// # Arguments
    ///
    /// * `function` - Name of the exported WASM function to call.
    /// * `input` - Input bytes to pass to the function.
    ///
    /// # Errors
    ///
    /// Returns `ExecutionError` if the function is not found, fuel is exhausted,
    /// epoch deadline is reached, or the function traps.
    pub fn execute(
        &mut self,
        function: &str,
        input: &[u8],
    ) -> Result<Vec<u8>, ExecutionError> {
        if self.store.data().terminated {
            return Err(ExecutionError::Terminated);
        }

        // Reset per-execution state.
        self.store.data_mut().host_calls_count = 0;

        // Refuel for this execution.
        let fuel_remaining = self
            .store
            .get_fuel()
            .map_err(|e| ExecutionError::Trap(format!("failed to get fuel: {e}")))?;
        if fuel_remaining < self.config.fuel_limit {
            let to_add = self.config.fuel_limit - fuel_remaining;
            self.store
                .set_fuel(self.config.fuel_limit)
                .map_err(|e| ExecutionError::Trap(format!("failed to refuel: {e}")))?;
            // Track cumulative consumption.
            self.store.data_mut().fuel_consumed += to_add;
        }

        // Reset epoch deadline.
        self.store.set_epoch_deadline(self.config.epoch_deadline);

        // Look up the exported function.
        let func = self
            .instance
            .get_typed_func::<(i32, i32), i32>(&mut self.store, function)
            .map_err(|_| ExecutionError::FunctionNotFound(function.to_string()))?;

        // Write input to memory if there's data.
        let input_ptr = if !input.is_empty() {
            // Try to get the memory export from the instance or linker-defined memory.
            let memory = self.get_memory()?;
            let mem_data = memory.data_mut(&mut self.store);

            // Write input at offset 0 (simple allocation strategy for sandbox).
            if input.len() > mem_data.len() {
                return Err(ExecutionError::MemoryLimitExceeded);
            }
            mem_data[..input.len()].copy_from_slice(input);
            0i32
        } else {
            0i32
        };

        // Call the function.
        let result = func
            .call(&mut self.store, (input_ptr, input.len() as i32))
            .map_err(|e| Self::classify_trap(e))?;

        // Update memory usage tracking.
        if let Ok(memory) = self.get_memory() {
            self.store.data_mut().memory_used_bytes = memory.data_size(&self.store);
        }

        // Read output from memory (result is the length of output at offset 0).
        if result > 0 {
            let memory = self.get_memory()?;
            let mem_data = memory.data(&self.store);
            let output_len = result as usize;
            if output_len > mem_data.len() {
                return Err(ExecutionError::MemoryLimitExceeded);
            }
            Ok(mem_data[..output_len].to_vec())
        } else {
            Ok(Vec::new())
        }
    }

    /// Terminate the sandbox immediately.
    ///
    /// Marks the sandbox as terminated. Subsequent calls to `execute()` will
    /// return `ExecutionError::Terminated`.
    pub fn terminate(&mut self) {
        self.store.data_mut().terminated = true;
        // Exhaust fuel to prevent any further execution.
        let _ = self.store.set_fuel(0);
    }

    /// Get current resource usage for this sandbox.
    pub fn resource_usage(&self) -> ResourceUsage {
        let state = self.store.data();
        ResourceUsage {
            fuel_consumed: state.fuel_consumed,
            memory_used_bytes: state.memory_used_bytes,
            host_calls_count: state.host_calls_count,
            active: !state.terminated,
        }
    }

    /// Get a reference to the engine (useful for epoch incrementing from external threads).
    pub fn engine(&self) -> &Arc<Engine> {
        &self.engine
    }

    /// Check if the sandbox has been terminated.
    pub fn is_terminated(&self) -> bool {
        self.store.data().terminated
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /// Get the linear memory from the instance.
    fn get_memory(&mut self) -> Result<Memory, ExecutionError> {
        self.instance
            .get_memory(&mut self.store, "memory")
            .ok_or_else(|| {
                ExecutionError::Trap("no memory export found in WASM module".to_string())
            })
    }

    /// Classify a wasmtime trap into a specific ExecutionError.
    fn classify_trap(error: wasmtime::Error) -> ExecutionError {
        // In wasmtime 27, trap codes are accessed via downcast_ref.
        if let Some(trap) = error.downcast_ref::<wasmtime::Trap>() {
            match trap {
                wasmtime::Trap::OutOfFuel => return ExecutionError::FuelExhausted,
                wasmtime::Trap::Interrupt => return ExecutionError::EpochDeadline,
                _ => {}
            }
        }
        // Fallback: check the error message string.
        let msg = error.to_string();
        if msg.contains("all fuel consumed") || msg.contains("out of fuel") {
            ExecutionError::FuelExhausted
        } else if msg.contains("epoch") || msg.contains("interrupt") {
            ExecutionError::EpochDeadline
        } else {
            ExecutionError::Trap(msg)
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal valid WASM module that exports a function.
    /// This module exports a function "run" that takes (i32, i32) and returns i32.
    /// It simply returns 0 (no output).
    fn minimal_wasm_module() -> Vec<u8> {
        // WAT: (module
        //   (memory (export "memory") 1)
        //   (func (export "run") (param i32 i32) (result i32)
        //     i32.const 0
        //   )
        // )
        wat::parse_str(
            r#"
            (module
                (memory (export "memory") 1)
                (func (export "run") (param i32 i32) (result i32)
                    i32.const 0
                )
            )
            "#,
        )
        .expect("failed to parse WAT")
    }

    /// WASM module that consumes fuel by looping.
    fn fuel_consuming_wasm_module() -> Vec<u8> {
        wat::parse_str(
            r#"
            (module
                (memory (export "memory") 1)
                (func (export "run") (param i32 i32) (result i32)
                    (local $i i32)
                    (local.set $i (i32.const 0))
                    (block $break
                        (loop $loop
                            (local.set $i (i32.add (local.get $i) (i32.const 1)))
                            (br_if $break (i32.ge_u (local.get $i) (i32.const 1000000)))
                            (br $loop)
                        )
                    )
                    i32.const 0
                )
            )
            "#,
        )
        .expect("failed to parse WAT")
    }

    #[test]
    fn test_sandbox_config_default() {
        let config = SandboxConfig::default();
        assert_eq!(config.max_memory_mb, 128);
        assert_eq!(config.max_cpu_millicores, 500);
        assert_eq!(config.fuel_limit, 1_000_000);
        assert_eq!(config.epoch_deadline, 100);
        assert_eq!(config.max_host_calls, 1000);
    }

    #[test]
    fn test_sandbox_config_validate_valid() {
        let config = SandboxConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_sandbox_config_validate_zero_memory() {
        let config = SandboxConfig {
            max_memory_mb: 0,
            ..SandboxConfig::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_sandbox_config_validate_zero_fuel() {
        let config = SandboxConfig {
            fuel_limit: 0,
            ..SandboxConfig::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_sandbox_config_validate_zero_epoch() {
        let config = SandboxConfig {
            epoch_deadline: 0,
            ..SandboxConfig::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_sandbox_config_max_memory_bytes() {
        let config = SandboxConfig {
            max_memory_mb: 64,
            ..SandboxConfig::default()
        };
        assert_eq!(config.max_memory_bytes(), 64 * 1024 * 1024);
    }

    #[test]
    fn test_sandbox_creation_success() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let sandbox = WasmSandbox::new(agent_id.clone(), &wasm, config);
        assert!(sandbox.is_ok());

        let sandbox = sandbox.unwrap();
        assert_eq!(sandbox.agent_id, agent_id);
        assert!(!sandbox.is_terminated());
    }

    #[test]
    fn test_sandbox_creation_invalid_wasm() {
        let invalid_wasm = b"not a valid wasm module";
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let result = WasmSandbox::new(agent_id, invalid_wasm, config);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), SandboxError::ModuleCompilation(_)));
    }

    #[test]
    fn test_sandbox_execute_success() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let mut sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        let result = sandbox.execute("run", &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn test_sandbox_execute_function_not_found() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let mut sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        let result = sandbox.execute("nonexistent", &[]);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ExecutionError::FunctionNotFound(_)
        ));
    }

    #[test]
    fn test_sandbox_execute_after_terminate() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let mut sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        sandbox.terminate();

        let result = sandbox.execute("run", &[]);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ExecutionError::Terminated));
    }

    #[test]
    fn test_sandbox_terminate() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let mut sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        assert!(!sandbox.is_terminated());

        sandbox.terminate();
        assert!(sandbox.is_terminated());
    }

    #[test]
    fn test_sandbox_resource_usage_initial() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        let usage = sandbox.resource_usage();

        assert_eq!(usage.fuel_consumed, 0);
        assert_eq!(usage.host_calls_count, 0);
        assert!(usage.active);
    }

    #[test]
    fn test_sandbox_resource_usage_after_terminate() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();
        let agent_id = AgentId::new("test-agent");

        let mut sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        sandbox.terminate();

        let usage = sandbox.resource_usage();
        assert!(!usage.active);
    }

    #[test]
    fn test_sandbox_fuel_exhaustion() {
        let wasm = fuel_consuming_wasm_module();
        // Very low fuel limit to trigger exhaustion.
        let config = SandboxConfig {
            fuel_limit: 100,
            ..SandboxConfig::default()
        };
        let agent_id = AgentId::new("test-agent");

        let mut sandbox = WasmSandbox::new(agent_id, &wasm, config).unwrap();
        let result = sandbox.execute("run", &[]);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ExecutionError::FuelExhausted));
    }

    #[test]
    fn test_sandbox_memory_isolation() {
        // Each sandbox gets its own memory — verify two sandboxes are independent.
        let wasm = minimal_wasm_module();
        let config = SandboxConfig {
            max_memory_mb: 1,
            ..SandboxConfig::default()
        };

        let mut sandbox_a =
            WasmSandbox::new(AgentId::new("agent-a"), &wasm, config.clone()).unwrap();
        let mut sandbox_b =
            WasmSandbox::new(AgentId::new("agent-b"), &wasm, config).unwrap();

        // Execute in both — they should not interfere.
        let result_a = sandbox_a.execute("run", &[1, 2, 3]);
        let result_b = sandbox_b.execute("run", &[4, 5, 6]);

        assert!(result_a.is_ok());
        assert!(result_b.is_ok());

        // Terminating one should not affect the other.
        sandbox_a.terminate();
        assert!(sandbox_a.is_terminated());
        assert!(!sandbox_b.is_terminated());

        let result_b2 = sandbox_b.execute("run", &[]);
        assert!(result_b2.is_ok());
    }

    #[test]
    fn test_sandbox_state_host_call_tracking() {
        let mut state = SandboxState::new(3);
        assert!(state.can_make_host_call());

        assert!(state.record_host_call().is_ok());
        assert!(state.record_host_call().is_ok());
        assert!(state.record_host_call().is_ok());

        // 4th call should fail.
        assert!(!state.can_make_host_call());
        assert!(state.record_host_call().is_err());
    }

    #[test]
    fn test_sandbox_each_has_own_engine() {
        let wasm = minimal_wasm_module();
        let config = SandboxConfig::default();

        let sandbox_a =
            WasmSandbox::new(AgentId::new("agent-a"), &wasm, config.clone()).unwrap();
        let sandbox_b =
            WasmSandbox::new(AgentId::new("agent-b"), &wasm, config).unwrap();

        // Each sandbox has its own engine (different Arc pointers).
        assert!(!Arc::ptr_eq(sandbox_a.engine(), sandbox_b.engine()));
    }
}
