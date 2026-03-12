import Game from './components/Game';
import { FirebaseProvider } from './components/FirebaseProvider';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <div className="min-h-screen bg-black">
          <Game />
        </div>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}
