declare global {
  interface Window {
    mixpanel?: {
      track: (event: string, properties?: Record<string, any>) => void;
    };
  }
}
export {};
