// Package logger provides structured JSON logging for PicoClaw.
//
// Each log entry is output as a single JSON line with required fields:
//   - timestamp: ISO 8601 format (RFC 3339)
//   - agent_id: identifier of the agent emitting the log
//   - level: "info", "warn", or "error"
//   - message: human-readable log message
//   - metadata: optional additional context (omitted if nil)
package logger

import (
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"
)

// Level represents the severity of a log entry.
type Level string

const (
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
)

// Entry represents a single structured log entry.
type Entry struct {
	Timestamp string                 `json:"timestamp"`
	AgentID   string                 `json:"agent_id"`
	Level     Level                  `json:"level"`
	Message   string                 `json:"message"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Logger outputs structured JSON log entries.
type Logger struct {
	agentID string
	writer  io.Writer
	mu      sync.Mutex
}

// New creates a new Logger that writes to stdout.
func New(agentID string) *Logger {
	return &Logger{
		agentID: agentID,
		writer:  os.Stdout,
	}
}

// NewWithWriter creates a new Logger that writes to the specified writer.
// Useful for testing.
func NewWithWriter(agentID string, w io.Writer) *Logger {
	return &Logger{
		agentID: agentID,
		writer:  w,
	}
}

// Info logs a message at info level.
func (l *Logger) Info(message string, metadata map[string]interface{}) {
	l.log(LevelInfo, message, metadata)
}

// Warn logs a message at warn level.
func (l *Logger) Warn(message string, metadata map[string]interface{}) {
	l.log(LevelWarn, message, metadata)
}

// Error logs a message at error level.
func (l *Logger) Error(message string, metadata map[string]interface{}) {
	l.log(LevelError, message, metadata)
}

func (l *Logger) log(level Level, message string, metadata map[string]interface{}) {
	entry := Entry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		AgentID:   l.agentID,
		Level:     level,
		Message:   message,
	}

	if metadata != nil && len(metadata) > 0 {
		entry.Metadata = metadata
	}

	data, err := json.Marshal(entry)
	if err != nil {
		// Fallback: write a minimal error entry if marshaling fails
		data = []byte(`{"timestamp":"` + entry.Timestamp + `","agent_id":"` + l.agentID + `","level":"error","message":"failed to marshal log entry"}`)
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = l.writer.Write(append(data, '\n'))
}
