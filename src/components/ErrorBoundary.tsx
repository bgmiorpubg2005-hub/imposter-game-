import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      
      try {
        // Check if it's a Firestore JSON error
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error && parsed.operationType) {
          errorMessage = `Firestore Error: ${parsed.error} during ${parsed.operationType} on ${parsed.path || 'unknown path'}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-indigo-950 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border border-red-500/50">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <h1 className="text-3xl font-black text-white mb-4 uppercase italic tracking-tighter">System Error</h1>
          <div className="bg-black/30 backdrop-blur-xl p-6 rounded-3xl border border-white/10 max-w-md mb-8">
            <p className="text-indigo-200 font-medium text-sm leading-relaxed">
              {errorMessage}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-8 py-4 bg-white text-indigo-950 rounded-2xl font-black hover:bg-indigo-50 transition-all shadow-xl"
          >
            <RefreshCw size={20} />
            RELOAD APP
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
