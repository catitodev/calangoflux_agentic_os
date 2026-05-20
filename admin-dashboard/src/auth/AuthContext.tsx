/**
 * Authentication Context
 *
 * Provides JWT auth state (token, login, logout) to the entire app.
 * Persists token in localStorage for session continuity.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { apiClient } from '../api/client';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const TOKEN_STORAGE_KEY = 'calangoflux_admin_token';

const AuthContext = createContext<AuthState | undefined>(undefined);

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable — continue without persistence
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const stored = getStoredToken();
    if (stored) {
      apiClient.setToken(stored);
    }
    return stored;
  });

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.login({ email, password });
    setToken(response.token);
    storeToken(response.token);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    storeToken(null);
    apiClient.setToken(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      logout,
    }),
    [token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
