import { Component } from 'react';

// Пази приложението от „бял екран“ при неочаквана грешка.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <h2>Нещо се обърка 😔</h2>
          <p>Приложението срещна неочаквана грешка. Презареди страницата, за да продължиш.</p>
          <button onClick={() => window.location.reload()}>Презареди</button>
        </div>
      );
    }
    return this.props.children;
  }
}
