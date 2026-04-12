import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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
      let errorDetails = null;
      try {
        if (this.state.error?.message) {
          errorDetails = JSON.parse(this.state.error.message);
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 max-w-lg w-full text-center space-y-6">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-600">
              <AlertTriangle className="w-10 h-10" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900">عذراً، حدث خطأ غير متوقع</h1>
              <p className="text-slate-500">
                {errorDetails 
                  ? `خطأ في قاعدة البيانات: ${errorDetails.operationType} على ${errorDetails.path}`
                  : 'حدث خطأ أثناء تشغيل التطبيق. يرجى المحاولة مرة أخرى.'}
              </p>
            </div>

            {errorDetails && (
              <div className="bg-slate-50 p-4 rounded-xl text-left text-xs font-mono overflow-auto max-h-40">
                <pre>{JSON.stringify(errorDetails, null, 2)}</pre>
              </div>
            )}

            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all mx-auto font-bold"
            >
              <RefreshCw className="w-5 h-5" />
              <span>إعادة تحميل الصفحة</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
