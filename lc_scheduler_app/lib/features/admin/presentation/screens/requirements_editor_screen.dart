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

class RequirementsEditorScreen extends ConsumerStatefulWidget {
  const RequirementsEditorScreen({super.key});

  @override
  ConsumerState<RequirementsEditorScreen> createState() => _RequirementsEditorScreenState();
}

class _RequirementsEditorScreenState extends ConsumerState<RequirementsEditorScreen> {
  String _selectedDay = 'monday';
  String _storeId = '';
  List<String> _positions = [];
  Map<int, Map<int, int>> _matrix = {};
  bool _isLoading = true;
  bool _isSaving = false;
  bool _hasChanges = false;
  DateTime? _lastUpdate;

  @override
  void initState() {
    super.initState();
    final today = DateTime.now().weekday;
    if (today >= 1 && today <= 7) _selectedDay = weekdayKeys[today - 1];
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    
    try {
      final userData = await ref.read(userDataProvider.future);
      _storeId = userData?['storeId'] ?? '';
      
      if (_storeId.isEmpty) {
        setState(() => _isLoading = false);
        return;
      }
      
      await _loadRequirements();
    } catch (e) {
      debugPrint('Error loading data: $e');
    }
    
    setState(() => _isLoading = false);
  }

  Future<void> _loadRequirements() async {
    if (_storeId.isEmpty) return;

    // Intentar subcolección de tienda
    var snap = await FirebaseFirestore.instance
        .collection('stores').doc(_storeId)
        .collection('positioning_requirements').doc(_selectedDay)
        .get();

    // Fallback a raíz
    if (!snap.exists) {
      snap = await FirebaseFirestore.instance
          .collection('positioning_requirements').doc(_selectedDay)
          .get();
    }

    if (snap.exists) {
      final data = snap.data()!;
      final List<String> positions = List<String>.from(data['positions'] ?? []);
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

      setState(() {
        _positions = positions;
        _matrix = expandedMatrix;
        _lastUpdate = DateTime.now();
        _hasChanges = false;
      });
    } else {
      setState(() {
        _positions = [];
        _matrix = {};
        _hasChanges = false;
      });
    }
  }

  Future<void> _saveRequirements() async {
    if (_storeId.isEmpty) return;

    setState(() => _isSaving = true);

    try {
      // Comprimir matriz (solo guardar valores > 0)
      final Map<String, Map<String, int>> compressedMatrix = {};
      _matrix.forEach((rowIndex, rowData) {
        final Map<String, int> rowMap = {};
        rowData.forEach((colIndex, value) {
          if (value > 0) {
            rowMap[colIndex.toString()] = value;
          }
        });
        if (rowMap.isNotEmpty) {
          compressedMatrix[rowIndex.toString()] = rowMap;
        }
      });

      await FirebaseFirestore.instance
          .collection('stores').doc(_storeId)
          .collection('positioning_requirements').doc(_selectedDay)
          .set({
            'positions': _positions,
            'matrix': compressedMatrix,
            'updatedAt': FieldValue.serverTimestamp(),
          });

      setState(() {
        _isSaving = false;
        _hasChanges = false;
        _lastUpdate = DateTime.now();
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Requerimientos guardados'),
            backgroundColor: AppTheme.successColor,
          ),
        );
      }
    } catch (e) {
      setState(() => _isSaving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al guardar: $e'),
            backgroundColor: AppTheme.errorColor,
          ),
        );
      }
    }
  }

  void _updateCell(int row, int col, int value) {
    setState(() {
      _matrix.putIfAbsent(row, () => {});
      _matrix[row]![col] = value.clamp(0, 10);
      _hasChanges = true;
    });
  }

  int _getCell(int row, int col) => _matrix[row]?[col] ?? 0;

  void _addPosition() {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nueva Posición'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Nombre de la posición',
            hintText: 'Ej: Caja, Inventario, Atención',
          ),
          textCapitalization: TextCapitalization.words,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              final newPosition = controller.text.trim();
              if (newPosition.isNotEmpty && !_positions.contains(newPosition)) {
                setState(() {
                  _positions.add(newPosition);
                  _hasChanges = true;
                });
                Navigator.pop(context);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primaryColor,
            ),
            child: const Text('Agregar'),
          ),
        ],
      ),
    );
  }

  void _removePosition(int index) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Eliminar Posición'),
        content: Text('¿Eliminar "${_positions[index]}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              setState(() {
                _positions.removeAt(index);
                _matrix.remove(index);
                // Reindexar matriz
                final newMatrix = <int, Map<int, int>>{};
                _matrix.forEach((key, value) {
                  if (key > index) {
                    newMatrix[key - 1] = value;
                  } else {
                    newMatrix[key] = value;
                  }
                });
                _matrix = newMatrix;
                _hasChanges = true;
              });
              Navigator.pop(context);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorColor,
            ),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
  }

  int get _totalPersonHours {
    int total = 0;
    _matrix.forEach((_, cols) => cols.forEach((_, v) => total += v));
    return total;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Editar Requerimientos'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () {
            if (_hasChanges) {
              showDialog(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Cambios sin guardar'),
                  content: const Text('¿Descartar cambios?'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancelar'),
                    ),
                    ElevatedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        Navigator.pop(context);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.errorColor,
                      ),
                      child: const Text('Descartar'),
                    ),
                  ],
                ),
              );
            } else {
              Navigator.pop(context);
            }
          },
        ),
        actions: [
          if (_hasChanges)
            TextButton.icon(
              onPressed: _isSaving ? null : _saveRequirements,
              icon: _isSaving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(LucideIcons.save),
              label: const Text('Guardar'),
            ),
        ],
      ),
      body: Column(
        children: [
          // Indicador de cambios
          if (_hasChanges)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: AppTheme.warningColor.withOpacity(0.1),
              child: Row(
                children: [
                  Icon(LucideIcons.alertCircle, size: 16, color: AppTheme.warningColor),
                  const SizedBox(width: 8),
                  const Text(
                    'Cambios sin guardar',
                    style: TextStyle(fontSize: 13, color: AppTheme.warningColor),
                  ),
                ],
              ),
            ),

          // Última actualización
          if (_lastUpdate != null && !_hasChanges)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: AppTheme.successColor.withOpacity(0.1),
              child: Row(
                children: [
                  Icon(LucideIcons.check, size: 14, color: AppTheme.successColor),
                  const SizedBox(width: 8),
                  Text(
                    'Actualizado: ${_lastUpdate!.hour.toString().padLeft(2, '0')}:${_lastUpdate!.minute.toString().padLeft(2, '0')}',
                    style: const TextStyle(fontSize: 12, color: AppTheme.successColor),
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
                  onTap: () async {
                    if (_hasChanges) {
                      final save = await showDialog<bool>(
                        context: context,
                        builder: (context) => AlertDialog(
                          title: const Text('Cambios sin guardar'),
                          content: const Text('¿Guardar antes de cambiar de día?'),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(context, false),
                              child: const Text('No guardar'),
                            ),
                            ElevatedButton(
                              onPressed: () => Navigator.pop(context, true),
                              child: const Text('Guardar'),
                            ),
                          ],
                        ),
                      );
                      if (save == true) {
                        await _saveRequirements();
                      }
                    }
                    setState(() => _selectedDay = day);
                    _loadRequirements();
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
                : _buildContent(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addPosition,
        backgroundColor: AppTheme.primaryColor,
        icon: const Icon(LucideIcons.plus),
        label: const Text('Posición'),
      ),
    );
  }

  Widget _buildContent() {
    if (_positions.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(LucideIcons.layoutGrid, size: 48, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(
              'Sin posiciones para ${weekdayLabels[_selectedDay]}',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.grey.shade700),
            ),
            const SizedBox(height: 8),
            Text('Agrega posiciones para comenzar', style: TextStyle(color: Colors.grey.shade500)),
          ],
        ),
      );
    }

    final estimatedHours = (_totalPersonHours * 0.25).round();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Resumen
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    children: [
                      const Icon(LucideIcons.layers, color: Colors.white),
                      const SizedBox(height: 8),
                      Text(
                        '${_positions.length}',
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.white),
                      ),
                      Text('Posiciones', style: TextStyle(fontSize: 12, color: Colors.white.withOpacity(0.7))),
                    ],
                  ),
                ),
                Expanded(
                  child: Column(
                    children: [
                      const Icon(LucideIcons.clock, color: Colors.white),
                      const SizedBox(height: 8),
                      Text(
                        '${estimatedHours}h',
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.white),
                      ),
                      Text('Persona-hora', style: TextStyle(fontSize: 12, color: Colors.white.withOpacity(0.7))),
                    ],
                  ),
                ),
              ],
            ),
          ).animate().fadeIn(),

          const SizedBox(height: 20),

          // Lista de posiciones con slider
          Text(
            'Posiciones',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),

          ..._positions.asMap().entries.map((entry) {
            final index = entry.key;
            final position = entry.value;
            final totalForPosition = _matrix[index]?.values.fold<int>(0, (a, b) => a + b) ?? 0;
            final hours = (totalForPosition * 0.25).toStringAsFixed(1);

            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.04),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 4, height: 40,
                        decoration: BoxDecoration(
                          color: AppTheme.primaryColor,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(position, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                            Text('${hours}h estimadas', style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(LucideIcons.trash2, color: AppTheme.errorColor),
                        onPressed: () => _removePosition(index),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  // Slider simplificado para pico
                  Row(
                    children: [
                      const Text('Pico: '),
                      Expanded(
                        child: Slider(
                          value: _getMaxForPosition(index).toDouble(),
                          min: 0,
                          max: 10,
                          divisions: 10,
                          label: '${_getMaxForPosition(index)} personas',
                          onChanged: (value) {
                            _setUniformValue(index, value.toInt());
                          },
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${_getMaxForPosition(index)}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppTheme.primaryColor,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ).animate().fadeIn(delay: Duration(milliseconds: index * 50));
          }),

          const SizedBox(height: 80), // Espacio para FAB
        ],
      ),
    );
  }

  int _getMaxForPosition(int row) {
    if (!_matrix.containsKey(row)) return 0;
    return _matrix[row]!.values.fold<int>(0, (max, v) => v > max ? v : max);
  }

  void _setUniformValue(int row, int value) {
    setState(() {
      _matrix.putIfAbsent(row, () => {});
      // Establecer el valor para todas las horas (simplificado)
      for (int col = 0; col < hours.length; col++) {
        _matrix[row]![col] = value;
      }
      _hasChanges = true;
    });
  }
}
