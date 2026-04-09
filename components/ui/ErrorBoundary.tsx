import React from 'react';

export interface BoundaryErrorDetails {
  error: Error;
  componentStack: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode | ((details: BoundaryErrorDetails) => React.ReactNode);
  onError?: (details: BoundaryErrorDetails) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: '',
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const details: BoundaryErrorDetails = {
      error,
      componentStack: info.componentStack ?? '',
    };

    this.setState({ componentStack: details.componentStack });
    this.props.onError?.(details);

    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    const { error, componentStack } = this.state;

    if (error) {
      const details: BoundaryErrorDetails = { error, componentStack };

      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(details);
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="m-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-sm">
          <h2 className="font-serif text-2xl font-bold">A aplicação encontrou um erro</h2>
          <p className="mt-2 text-sm text-red-800">{error.message}</p>
          {componentStack && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-white/70 p-4 text-xs text-red-900 whitespace-pre-wrap">
              {componentStack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
