import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './card';
import { Button } from './button';

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
        <Card className="h-full border-red-900/60 bg-red-950/20 text-red-200 p-4 flex flex-col justify-between">
          <CardHeader className="p-0 pb-2">
            <CardTitle className="text-xs font-bold text-red-400 flex items-center gap-1.5 uppercase">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              {this.props.fallbackTitle || 'Widget Error'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-xs font-mono space-y-2 flex-1">
            <p className="text-red-300">This widget encountered an error and was safely isolated.</p>
            <p className="text-[10px] text-zinc-500 break-all">{this.state.error?.message}</p>
          </CardContent>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 text-xs border-red-800 text-red-300 hover:bg-red-950/50"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Retry
          </Button>
        </Card>
      );
    }
    return this.props.children;
  }
}
