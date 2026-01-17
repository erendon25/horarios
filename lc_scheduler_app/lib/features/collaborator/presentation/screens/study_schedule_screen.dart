import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

/// Mismo formato que StudyScheduleForm.jsx de la web
/// Estructura: study_schedules/{uid} -> { monday: {free: bool, blocks: [{start, end}]}, ... }
class StudyScheduleScreen extends ConsumerStatefulWidget {
  const StudyScheduleScreen({super.key});

  @override
  ConsumerState<StudyScheduleScreen> createState() => _StudyScheduleScreenState();
}

class _StudyScheduleScreenState extends ConsumerState<StudyScheduleScreen> {
  // Estructura igual a la web
  Map<String, Map<String, dynamic>> _schedule = {};
  bool _isLoading = true;
  bool _isSaving = false;
  String? _userUid;
  DateTime? _lastUpdate;
  bool _hasChanges = false;

  final List<Map<String, String>> _weekDays = [
    {'key': 'monday', 'label': 'Lunes'},
    {'key': 'tuesday', 'label': 'Martes'},
    {'key': 'wednesday', 'label': 'Miércoles'},
    {'key': 'thursday', 'label': 'Jueves'},
    {'key': 'friday', 'label': 'Viernes'},
    {'key': 'saturday', 'label': 'Sábado'},
    {'key': 'sunday', 'label': 'Domingo'},
  ];

  @override
  void initState() {
    super.initState();
    _loadSchedule();
  }

  Future<void> _loadSchedule() async {
    setState(() => _isLoading = true);
    
    try {
      final authState = await ref.read(authStateProvider.future);
      if (authState == null) return;

      _userUid = authState.uid;

      // Cargar desde Firestore (mismo doc que la web)
      final doc = await FirebaseFirestore.instance
          .collection('study_schedules')
          .doc(_userUid)
          .get();

      if (doc.exists) {
        final data = doc.data()!;
        // Convertir datos de Firestore al formato local
        _schedule = {};
        for (var day in _weekDays) {
          final key = day['key']!;
          final dayData = data[key];
          if (dayData is Map<String, dynamic>) {
            _schedule[key] = {
              'free': dayData['free'] ?? false,
              'blocks': List<Map<String, dynamic>>.from(
                (dayData['blocks'] as List<dynamic>? ?? []).map((b) => Map<String, dynamic>.from(b)),
              ),
            };
          } else {
            _schedule[key] = {'free': false, 'blocks': <Map<String, dynamic>>[]};
          }
        }
      } else {
        // Inicializar vacío
        for (var day in _weekDays) {
          _schedule[day['key']!] = {'free': false, 'blocks': <Map<String, dynamic>>[]};
        }
      }

      setState(() {
        _isLoading = false;
        _lastUpdate = DateTime.now();
        _hasChanges = false;
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

  Future<void> _saveSchedule() async {
    if (_userUid == null) return;

    setState(() => _isSaving = true);

    try {
      // Guardar en el mismo formato que la web
      final payload = <String, dynamic>{};
      for (var day in _weekDays) {
        final key = day['key']!;
        payload[key] = {
          'free': _schedule[key]?['free'] ?? false,
          'blocks': _schedule[key]?['blocks'] ?? [],
        };
      }

      await FirebaseFirestore.instance
          .collection('study_schedules')
          .doc(_userUid)
          .set(payload);

      setState(() {
        _hasChanges = false;
        _lastUpdate = DateTime.now();
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Horarios guardados correctamente'),
            backgroundColor: AppTheme.successColor,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.errorColor),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _toggleFree(String dayKey) {
    setState(() {
      final current = _schedule[dayKey]?['free'] ?? false;
      _schedule[dayKey] = {
        'free': !current,
        'blocks': current ? (_schedule[dayKey]?['blocks'] ?? []) : <Map<String, dynamic>>[],
      };
      _hasChanges = true;
    });
  }

  void _addBlock(String dayKey) {
    setState(() {
      final blocks = List<Map<String, dynamic>>.from(_schedule[dayKey]?['blocks'] ?? []);
      blocks.add({'start': '08:00', 'end': '12:00'});
      _schedule[dayKey] = {
        'free': false,
        'blocks': blocks,
      };
      _hasChanges = true;
    });
  }

  void _updateBlock(String dayKey, int index, String field, String value) {
    setState(() {
      final blocks = List<Map<String, dynamic>>.from(_schedule[dayKey]?['blocks'] ?? []);
      if (index < blocks.length) {
        blocks[index] = {...blocks[index], field: value};
        _schedule[dayKey]?['blocks'] = blocks;
        _hasChanges = true;
      }
    });
  }

  void _removeBlock(String dayKey, int index) {
    setState(() {
      final blocks = List<Map<String, dynamic>>.from(_schedule[dayKey]?['blocks'] ?? []);
      if (index < blocks.length) {
        blocks.removeAt(index);
        _schedule[dayKey]?['blocks'] = blocks;
        _hasChanges = true;
      }
    });
  }

  Future<void> _pickTime(String dayKey, int index, String field) async {
    final blocks = List<Map<String, dynamic>>.from(_schedule[dayKey]?['blocks'] ?? []);
    if (index >= blocks.length) return;

    final current = blocks[index][field] ?? '08:00';
    final parts = current.split(':');
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.tryParse(parts[0]) ?? 8,
        minute: int.tryParse(parts.length > 1 ? parts[1] : '0') ?? 0,
      ),
    );
    
    if (time != null) {
      final formatted = '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
      _updateBlock(dayKey, index, field, formatted);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Horarios de Estudio'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          // Actualizar
          IconButton(
            icon: const Icon(LucideIcons.refreshCw, size: 20),
            onPressed: _isLoading ? null : _loadSchedule,
            tooltip: 'Actualizar',
          ),
          // Guardar
          TextButton.icon(
            onPressed: (_isSaving || !_hasChanges) ? null : _saveSchedule,
            icon: _isSaving
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(LucideIcons.save, size: 18, color: _hasChanges ? AppTheme.primaryColor : Colors.grey),
            label: Text(
              'Guardar',
              style: TextStyle(color: _hasChanges ? AppTheme.primaryColor : Colors.grey),
            ),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Indicador de cambios pendientes
                if (_hasChanges)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    color: AppTheme.warningColor.withValues(alpha: 0.1),
                    child: Row(
                      children: [
                        Icon(LucideIcons.alertCircle, size: 14, color: AppTheme.warningColor),
                        const SizedBox(width: 8),
                        const Text(
                          'Tienes cambios sin guardar',
                          style: TextStyle(fontSize: 12, color: AppTheme.warningColor),
                        ),
                        const Spacer(),
                        GestureDetector(
                          onTap: _saveSchedule,
                          child: const Text(
                            'Guardar ahora',
                            style: TextStyle(fontSize: 12, color: AppTheme.primaryColor, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  )
                else if (_lastUpdate != null)
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
                      ],
                    ),
                  ),

                // Info
                Container(
                  margin: const EdgeInsets.all(16),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppTheme.infoColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.infoColor.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(LucideIcons.graduationCap, color: AppTheme.infoColor, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Agrega tus horarios de estudio. Marca "día libre" si necesitas ese día completo.',
                          style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                        ),
                      ),
                    ],
                  ),
                ),

                // Lista de días
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _weekDays.length,
                    itemBuilder: (context, index) {
                      final day = _weekDays[index];
                      final dayKey = day['key']!;
                      final dayData = _schedule[dayKey] ?? {'free': false, 'blocks': []};
                      final isFree = dayData['free'] == true;
                      final blocks = List<Map<String, dynamic>>.from(dayData['blocks'] ?? []);

                      return _DayCard(
                        label: day['label']!,
                        dayKey: dayKey,
                        isFree: isFree,
                        blocks: blocks,
                        onToggleFree: () => _toggleFree(dayKey),
                        onAddBlock: () => _addBlock(dayKey),
                        onRemoveBlock: (i) => _removeBlock(dayKey, i),
                        onPickTime: (i, f) => _pickTime(dayKey, i, f),
                      ).animate().fadeIn(delay: Duration(milliseconds: 50 * index));
                    },
                  ),
                ),
              ],
            ),
    );
  }

  String _formatTime(DateTime dt) {
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}

class _DayCard extends StatelessWidget {
  final String label;
  final String dayKey;
  final bool isFree;
  final List<Map<String, dynamic>> blocks;
  final VoidCallback onToggleFree;
  final VoidCallback onAddBlock;
  final Function(int) onRemoveBlock;
  final Function(int, String) onPickTime;

  const _DayCard({
    required this.label,
    required this.dayKey,
    required this.isFree,
    required this.blocks,
    required this.onToggleFree,
    required this.onAddBlock,
    required this.onRemoveBlock,
    required this.onPickTime,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isFree ? AppTheme.successColor : Colors.grey.shade200),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        children: [
          // Header del día
          ListTile(
            leading: Container(
              width: 42, height: 42,
              decoration: BoxDecoration(
                gradient: isFree 
                    ? const LinearGradient(colors: [Color(0xFF10B981), Color(0xFF059669)])
                    : AppTheme.primaryGradient,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                isFree ? LucideIcons.checkCircle : LucideIcons.clock,
                color: Colors.white, size: 20,
              ),
            ),
            title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
              isFree ? 'Día libre solicitado' : '${blocks.length} bloques',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
            trailing: Switch(
              value: isFree,
              onChanged: (_) => onToggleFree(),
              activeColor: AppTheme.successColor,
            ),
          ),

          // Bloques de horario
          if (!isFree) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  ...blocks.asMap().entries.map((entry) {
                    final i = entry.key;
                    final block = entry.value;
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.grey.shade200),
                      ),
                      child: Row(
                        children: [
                          // Inicio
                          Expanded(
                            child: GestureDetector(
                              onTap: () => onPickTime(i, 'start'),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: Colors.grey.shade300),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(LucideIcons.clock, size: 14, color: Colors.grey.shade600),
                                    const SizedBox(width: 6),
                                    Text(block['start'] ?? '08:00', style: const TextStyle(fontWeight: FontWeight.w600)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            child: Icon(LucideIcons.arrowRight, size: 16, color: Colors.grey.shade400),
                          ),
                          // Fin
                          Expanded(
                            child: GestureDetector(
                              onTap: () => onPickTime(i, 'end'),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: Colors.grey.shade300),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(LucideIcons.clock, size: 14, color: Colors.grey.shade600),
                                    const SizedBox(width: 6),
                                    Text(block['end'] ?? '12:00', style: const TextStyle(fontWeight: FontWeight.w600)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          // Eliminar
                          IconButton(
                            icon: Icon(LucideIcons.trash2, size: 18, color: Colors.red.shade400),
                            onPressed: () => onRemoveBlock(i),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          ),
                        ],
                      ),
                    );
                  }),
                  // Botón agregar bloque
                  TextButton.icon(
                    onPressed: onAddBlock,
                    icon: const Icon(LucideIcons.plus, size: 16),
                    label: const Text('Agregar bloque'),
                    style: TextButton.styleFrom(foregroundColor: AppTheme.primaryColor),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
