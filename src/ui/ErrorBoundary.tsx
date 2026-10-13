import { Component, type ReactNode } from 'react';
import { StatusScreen } from './StatusScreen';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <StatusScreen
          kind="error"
          title="Something went wrong"
          action={{ label: 'Reload', onClick: () => location.reload() }}
        >
          {this.state.error.message}
        </StatusScreen>
      );
    }
    return this.props.children;
  }
}
