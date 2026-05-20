// Package main is the entry point for PicoClaw — the ultra-lightweight
// task router/orchestrator for CalangoFlux Agentic OS.
//
// PicoClaw classifies intents and routes tasks to the appropriate agent
// with <10MB RAM usage and <1s startup time.
package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/catitodev/calangoflux_agentic_os/picoclaw/router"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	fmt.Println("PicoClaw Task Router starting...")

	// Support both REDIS_URL (docker-compose format) and REDIS_ADDR (host:port format)
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisURL := os.Getenv("REDIS_URL")
		if redisURL != "" {
			// Parse redis://host:port format to host:port
			// Strip "redis://" prefix if present
			addr := redisURL
			if len(addr) > 8 && addr[:8] == "redis://" {
				addr = addr[8:]
			}
			redisAddr = addr
		} else {
			redisAddr = "localhost:6379"
		}
	}

	r := router.NewRouter(router.RouterConfig{
		RedisAddr:   redisAddr,
		StreamName:  "tasks:router",
		GroupName:   "picoclaw-workers",
		FallbackMap: router.DefaultFallbackMap(),
	})

	if err := r.Start(); err != nil {
		log.Printf("Warning: could not start stream consumer: %v", err)
		log.Println("Running in standalone mode (no Redis connection)")
	} else {
		fmt.Println("PicoClaw connected to Redis Streams as consumer group 'picoclaw-workers'")
	}

	fmt.Println("PicoClaw Task Router ready.")

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("PicoClaw shutting down...")
	r.Stop()
	fmt.Println("PicoClaw stopped.")
}
