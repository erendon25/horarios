import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

/// Horas del día en formato legible (06:00 a 02:00)
final List<String> hours = List.generate(81, (i) {
  final totalMinutes = 360 + i * 15;
  final h = (totalMinutes ~/ 60) % 24;
  final m = totalMinutes % 60;
  return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
});

const List<String> weekdayKeys = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
];

const Map<String, String> weekdayLabels = {
  'monday': 'Lunes', 'tuesday': 'Martes', 'wednesday': 'Miércoles',
  'thursday': 'Jueves', 'friday': 'Viernes', 'saturday': 'Sábado', 'sunday': 'Domingo',
};

/// Modelo para requerimiento (igual que la web)
class PositionRequirement {
  final String day;
  final List<String> positions;
  final Map<int, Map<int, int>> matrix;

  PositionRequirement({required this.day, required this.positions, required this.matrix});

  factory PositionRequirement.fromFirestore(String day, Map<String, dynamic> data) {
    final positions = List<String>.from(data['positions'] ?? []);
    final compressedMatrix = data['matrix'] as Map<String, dynamic>? ?? {};
    final Map<int, Map<int, int>> expandedMatrix = {};
    
    compressedMatrix.forEach((rowKey, rowData) {
      final rowIndex = int.tryParse(rowKey) ?? 0;
      expandedMatrix[rowIndex] = {};
      if (rowData is Map<String, dynamic>) {
        rowData.forEach((colKey, value) {
          final colIndex = int.tryParse(colKey) ?? 0;
          expandedMatrix[rowIndex]![colIndex] = (value as num).toInt();
        });
      }
    });
    
    return PositionRequirement(day: day, positions: positions, matrix: expandedMatrix);
  }

  int getCell(int row, int col) => matrix[row]?[col] ?? 0;

  int get totalPersonHours {
    int total = 0;
    matrix.forEach((_, cols) => cols.forEach((_, v) => total += v));
    return total;
  }

  int get maxConcurrent {
    int max = 0;
    for (int col = 0; col < hours.length; col++) {
      int sum = 0;
      for (int row = 0; row < positions.length; row++) {
        sum += getCell(row, col);
      }
      if (sum > max) max = sum;
    }
    return max;
  }

  int getTotalForPosition(int row) {
    int total = 0;
    matrix[row]?.forEach((_, v) => total += v);
    return total;
  }
}

/// Función para cargar requerimientos (carga manual, no stream)
Future<PositionRequirement?> loadRequirements(String storeId, String day) async {
  if (storeId.isEmpty) return null;
  
  // Intentar subcolección de tienda
  var snap = await FirebaseFirestore.instance
      .collection('stores').doc(storeId)
      .collection('positioning_requirements').doc(day)
      .get();
  
  // Fallback a raíz
  if (!snap.exists) {
    snap = await FirebaseFirestore.instance
        .collection('positioning_requirements').doc(day)
        .get();
  }
  
  if (!snap.exists) return null;
  return PositionRequirement.fromFirestore(day, snap.data()!);
}

class RequirementsScreen extends ConsumerStatefulWidget {
  const RequirementsScreen({super.key});

  @override
  ConsumerState<RequirementsScreen> createState() => _RequirementsScreenState();
}

class _RequirementsScreenState extends ConsumerState<RequirementsScreen> {
  String _selectedDay = 'monday';
  String _storeId = '';
  PositionRequirement? _requirements;
  bool _isLoading = true;
  DateTime? _lastUpdate;

  @override
  void initState() {
    super.initState();
    final today = DateTime.now().weekday;
    if (today >= 1 && today <= 7) _selectedDay = weekdayKeys[today - 1];
    _loadData();
  }

  Future<void> _loadData() async {
    final userData = await ref.read(userDataProvider.future);
    _storeId = userData?['storeId'] ?? '';
    await _refreshRequirements();
  }

  Future<void> _refreshRequirements() async {
    setState(() => _isLoading = true);
    try {
      final req = await loadRequirements(_storeId, _selectedDay);
      setState(() {
        _requirements = req;
        _lastUpdate = DateTime.now();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.errorColor),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Requerimientos'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          // Botón actualizar
          IconButton(
            icon: _isLoading 
                ? const SizedBox(
                    width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(LucideIcons.refreshCw),
            onPressed: _isLoading ? null : _refreshRequirements,
            tooltip: 'Actualizar datos',
          ),
        ],
      ),
      body: Column(
        children: [
          // Última actualización
          if (_lastUpdate != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: AppTheme.successColor.withValues(alpha: 0.1),
              child: Row(
                children: [
                  Icon(LucideIcons.check, size: 14, color: AppTheme.successColor),
                  const SizedBox(width: 8),
                  Text(
                    'Actualizado: ${_formatTime(_lastUpdate!)}',
                    style: const TextStyle(fontSize: 12, color: AppTheme.successColor),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: _refreshRequirements,
                    child: const Text(
                      'Actualizar',
                      style: TextStyle(
                        fontSize: 12, 
                        color: AppTheme.primaryColor,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),

          // Selector de días
          Container(
            height: 48,
            margin: const EdgeInsets.symmetric(vertical: 8),
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: weekdayKeys.length,
              itemBuilder: (context, index) {
                final day = weekdayKeys[index];
                final isSelected = _selectedDay == day;
                final isToday = DateTime.now().weekday == index + 1;
                
                return GestureDetector(
                  onTap: () {
                    setState(() => _selectedDay = day);
                    _refreshRequirements();
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: isSelected ? AppTheme.primaryGradient : null,
                      color: isSelected ? null : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isToday && !isSelected ? AppTheme.primaryColor : (isSelected ? Colors.transparent : Colors.grey.shade200),
                        width: isToday && !isSelected ? 2 : 1,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          weekdayLabels[day]!,
                          style: TextStyle(
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                            fontSize: 13,
                            color: isSelected ? Colors.white : AppTheme.textPrimaryLight,
                          ),
                        ),
                        if (isToday) ...[
                          const SizedBox(width: 6),
                          Container(
                            width: 6, height: 6,
                            decoration: BoxDecoration(
                              color: isSelected ? Colors.white : AppTheme.primaryColor,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              },
            ),
          ),

          // Contenido
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _requirements == null || _requirements!.positions.isEmpty
                    ? _buildEmptyState()
                    : _buildContent(),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime dt) {
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(LucideIcons.clipboardX, size: 48, color: Colors.grey.shade400),
          const SizedBox(height: 16),
          Text('Sin configuración', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.grey.shade700)),
          const SizedBox(height: 8),
          Text('Configura desde la web', style: TextStyle(color: Colors.grey.shade500)),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _refreshRequirements,
            icon: const Icon(LucideIcons.refreshCw, size: 18),
            label: const Text('Actualizar'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primaryColor,
              foregroundColor: Colors.white,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    final req = _requirements!;
    final estimatedHours = (req.totalPersonHours * 0.25).round();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Card resumen
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(LucideIcons.calendar, color: Colors.white, size: 24),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Text(
                        weekdayLabels[_selectedDay] ?? _selectedDay,
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    _Metric(icon: LucideIcons.users, value: '${req.maxConcurrent}', label: 'Pico'),
                    _Metric(icon: LucideIcons.layers, value: '${req.positions.length}', label: 'Posiciones'),
                    _Metric(icon: LucideIcons.clock, value: '${estimatedHours}h', label: 'P-Hora'),
                  ],
                ),
              ],
            ),
          ).animate().fadeIn(),
          
          const SizedBox(height: 20),
          
          // Posiciones
          Text('Posiciones', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          
          ...req.positions.asMap().entries.map((e) {
            final hours = (req.getTotalForPosition(e.key) * 0.25).toStringAsFixed(1);
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Container(
                    width: 4, height: 40,
                    decoration: BoxDecoration(
                      color: AppTheme.primaryColor,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(e.value, style: const TextStyle(fontWeight: FontWeight.w600))),
                  Text('${hours}h', style: TextStyle(color: Colors.grey.shade600)),
                ],
              ),
            ).animate().fadeIn(delay: Duration(milliseconds: e.key * 50));
          }),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;

  const _Metric({required this.icon, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Icon(icon, color: Colors.white, size: 18),
          const SizedBox(height: 6),
          Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white)),
          Text(label, style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.7))),
        ],
      ),
    );
  }
}
