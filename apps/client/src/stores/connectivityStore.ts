export type ConnectionState = 'ONLINE' | 'OFFLINE' | 'SYNCING';

export class ConnectivityStore {
  private state: ConnectionState = navigator.onLine ? 'ONLINE' : 'OFFLINE';
  private listeners: Array<(state: ConnectionState) => void> = [];

  constructor() {
    window.addEventListener('online', () => this.setState('ONLINE'));
    window.addEventListener('offline', () => this.setState('OFFLINE'));
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public setState(newState: ConnectionState) {
    this.state = newState;
    this.listeners.forEach((callback) => callback(this.state));
  }

  public subscribe(callback: (state: ConnectionState) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }
}

export const connectivityStore = new ConnectivityStore();
