import { Component, ErrorInfo, ReactNode } from 'react';

import { AlertTriangle, RotateCcw } from 'lucide-react';

import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Widget render crash intercepted by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Card className="flex h-full flex-col justify-between border-red-900/60 bg-red-950/20 p-4 text-red-200">
          <CardHeader className="p-0 pb-2">
            <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase text-red-400">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              {this.props.fallbackTitle || 'Widget Error'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-2 p-0 font-mono text-xs">
            <p className="text-red-300">This widget encountered an error and was safely isolated.</p>
            <p className="break-all text-[10px] text-zinc-500">{this.state.error?.message}</p>
          </CardContent>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-red-800 text-xs text-red-300 hover:bg-red-950/50"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Retry
          </Button>
        </Card>
      );
    }
    return this.props.children;
  }
}
