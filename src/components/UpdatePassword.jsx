import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import background from '../assets/background.png';

export default function UpdatePassword() {
  const navigate = useNavigate();
  const { updatePassword, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await updatePassword(password);
      await logout();
      navigate('/login', { replace: true });
    } catch (updateError) {
      console.error('No se pudo actualizar la contraseña:', updateError);
      setError('El enlace venció o no es válido. Solicita uno nuevo desde la pantalla de ingreso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="relative min-h-screen flex items-center justify-center bg-cover bg-center px-4"
      style={{ backgroundImage: `url(${background})` }}
    >
      <div className="absolute inset-0 bg-black/55" />
      <form onSubmit={submit} className="relative z-10 w-full max-w-md rounded-2xl border border-white/30 bg-white/20 p-8 text-white shadow-2xl backdrop-blur-lg">
        <h1 className="mb-2 text-3xl font-bold">Crear nueva contraseña</h1>
        <p className="mb-6 text-sm text-blue-100">Usa el enlace de recuperación recibido por correo y registra una contraseña distinta.</p>
        {error && <p className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-100" role="alert">{error}</p>}
        <label className="mb-4 block text-sm font-semibold">
          Nueva contraseña
          <input type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg bg-white/90 p-3 text-gray-900" />
        </label>
        <label className="mb-6 block text-sm font-semibold">
          Confirmar contraseña
          <input type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-lg bg-white/90 p-3 text-gray-900" />
        </label>
        <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 p-3 font-bold transition hover:bg-blue-700 disabled:opacity-60">
          {loading ? 'Actualizando…' : 'Guardar contraseña'}
        </button>
      </form>
    </main>
  );
}
