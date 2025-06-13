// ✅ src/components/Login.jsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import background from '../assets/background.png';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const navigate = useNavigate();
    const { login, currentUser, userRole } = useAuth();


    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setError('');
            await login(email, password);
            setSubmitted(true);
        } catch {
            setError('Credenciales incorrectas.');
        }
    };

  useEffect(() => {
  if (submitted && currentUser) {
    if (!userRole) return; // Espera a que se cargue el rol

    switch (userRole) {
      case 'superadmin':
        navigate('/superadmin');
        break;
      case 'admin':
        navigate('/admin');
        break;
      case 'collaborator':
        navigate('/staff');
        break;
      default:
        setError('Rol no reconocido');
        break;
    }
  }
}, [submitted, currentUser, userRole, navigate]);




    return (
        <div
            className="relative min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${background})`, backgroundSize: 'cover' }}
        >
            <div className="absolute inset-0 bg-black/50 z-0" />
            <div className="relative z-10 bg-white/20 backdrop-blur-lg p-8 rounded-xl shadow-lg max-w-md w-full text-white border border-white/30">
                <h2 className="text-3xl font-bold text-center mb-6">Iniciar Sesión</h2>
                {error && <p className="text-red-200 text-sm text-center mb-4">{error}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="block text-sm">Correo Electrónico</label>
                        <input
                            id="email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full p-2 rounded bg-white/30 text-black placeholder-gray-700"
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm">Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full p-2 rounded bg-white/30 text-black placeholder-gray-700"
                        />
                    </div>
                    <button type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition">
                        Entrar
                    </button>
                </form>
                <p className="mt-4 text-center text-sm">
                    ¿No tienes cuenta? <Link to="/register" className="underline text-blue-200">Regístrate</Link>
                </p>
            </div>
        </div>
    );
}

export default Login;


