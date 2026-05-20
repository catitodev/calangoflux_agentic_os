/**
 * Protected Route
 *
 * Wrapper component that renders children only if the user is authenticated.
 * If not authenticated, renders the LoginPage instead.
 */

import React from 'react';
import { useAuth } from './AuthContext';
import { LoginPage } from './LoginPage';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
