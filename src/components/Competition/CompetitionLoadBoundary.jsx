import { Component } from 'react';

export default class CompetitionLoadBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="p-6 space-y-3">
          <p>No se pudo cargar el concurso. Comprueba tu conexión y vuelve a intentarlo.</p>
          <button className="rounded-lg bg-orange-600 px-4 py-2 text-white" onClick={() => window.location.reload()}>
            Volver a cargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
