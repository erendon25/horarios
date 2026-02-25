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
    const [message, setMessage] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { login, currentUser, userRole, resetPassword } = useAuth();


    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setError('');
            setMessage('');
            setLoading(true);
            await login(email, password);
            setSubmitted(true);
        } catch {
            setError('Credenciales incorrectas.');
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email) {
            setError('Por favor, ingresa tu correo electrónico primero.');
            return;
        }
        try {
            setError('');
            setMessage('');
            setLoading(true);
            await resetPassword(email);
            setMessage('Se ha enviado un correo para restablecer tu contraseña. Revisa tu bandeja de entrada.');
        } catch (error) {
            console.error(error);
            setError('No se pudo enviar el correo de restablecimiento. Verifica el email ingresado.');
        } finally {
            setLoading(false);
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
                {error && <p className="text-red-200 text-sm text-center mb-4 font-semibold">{error}</p>}
                {message && <p className="text-green-200 text-sm text-center mb-4 font-semibold">{message}</p>}
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
                            placeholder="ejemplo@correo.com"
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
                    <div className="text-right">
                        <button
                            type="button"
                            onClick={handleForgotPassword}
                            className="text-xs underline text-blue-200 hover:text-white transition decoration-dotted"
                            disabled={loading}
                        >
                            ¿Olvidaste tu contraseña?
                        </button>
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition font-bold ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {loading ? 'Cargando...' : 'Entrar'}
                    </button>
                </form>
                <p className="mt-4 text-center text-sm">
                    ¿No tienes cuenta? <Link to="/register" className="underline text-blue-200 hover:text-white transition">Regístrate</Link>
                </p>
            </div>
        </div>
    );
}

export default Login;


