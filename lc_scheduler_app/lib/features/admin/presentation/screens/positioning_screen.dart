import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

/// Genera la clave de semana en formato "YYYY-MM-DD_to_YYYY-MM-DD"
String getWeekKey(DateTime date) {
  // Encontrar el lunes de la semana
  final monday = date.subtract(Duration(days: date.weekday - 1));
  final sunday = monday.add(const Duration(days: 6));
  
  final format = DateFormat('yyyy-MM-dd');
  return '${format.format(monday)}_to_${format.format(sunday)}';
}

const weekdayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const weekdayLabels = {
  'monday': 'Lun', 'tuesday': 'Mar', 'wednesday': 'Mié',
  'thursday': 'Jue', 'friday': 'Vie', 'saturday': 'Sáb', 'sunday': 'Dom',
};

const weekdayLabelsFull = {
  'monday': 'Lunes', 'tuesday': 'Martes', 'wednesday': 'Miércoles',
  'thursday': 'Jueves', 'friday': 'Viernes', 'saturday': 'Sábado', 'sunday': 'Domingo',
};

class PositioningScreen extends ConsumerStatefulWidget {
  final String day;

  const PositioningScreen({super.key, required this.day});

  @override
  ConsumerState<PositioningScreen> createState() => _PositioningScreenState();
}

class _PositioningScreenState extends ConsumerState<PositioningScreen> {
  String _selectedDay = 'monday';
  DateTime _weekStartDate = DateTime.now();
  String _storeId = '';
  List<Map<String, dynamic>> _staffProfiles = [];
  Map<String, Map<String, dynamic>> _schedules = {};
  bool _isLoading = true;
  bool _isDisposed = false;

  @override
  void initState() {
    super.initState();
    _selectedDay = widget.day;
    _initWeekStart();
    _loadData();
  }

  @override
  void dispose() {
    _isDisposed = true;
    super.dispose();
  }

  void _safeSetState(VoidCallback fn) {
    if (!_isDisposed && mounted) {
      setState(fn);
    }
  }

  void _initWeekStart() {
    final now = DateTime.now();
    // Encontrar el lunes de esta semana
    _weekStartDate = now.subtract(Duration(days: now.weekday - 1));
  }

  Future<void> _loadData() async {
    _safeSetState(() => _isLoading = true);
    
    try {
      // Obtener storeId del usuario
      final userData = await ref.read(userDataProvider.future);
      if (_isDisposed) return;
      
      _storeId = userData?['storeId'] ?? '';
      
      if (_storeId.isEmpty) {
        _safeSetState(() => _isLoading = false);
        return;
      }
      
      // Cargar staff_profiles de la tienda
      final staffQuery = await FirebaseFirestore.instance
          .collection('staff_profiles')
          .where('storeId', isEqualTo: _storeId)
          .get();
      
      if (_isDisposed) return;
      
      _staffProfiles = staffQuery.docs.map((doc) => {
        'id': doc.id,
        ...doc.data(),
      }).toList();
      
      // Cargar horarios de la semana
      await _loadSchedules();
      
    } catch (e) {
      debugPrint('Error loading data: $e');
    }
    
    _safeSetState(() => _isLoading = false);
  }

  Future<void> _loadSchedules() async {
    if (_isDisposed) return;
    
    final weekKey = getWeekKey(_weekStartDate);
    _schedules = {};
    
    for (final staff in _staffProfiles) {
      if (_isDisposed) return;
      
      final staffId = staff['id'];
      final docId = '${staffId}_$weekKey';
      
      try {
        final doc = await FirebaseFirestore.instance
            .collection('schedules')
            .doc(docId)
            .get();
        
        if (_isDisposed) return;
        
        if (doc.exists) {
          _schedules[staffId] = doc.data() ?? {};
        }
      } catch (e) {
        debugPrint('Error loading schedule for $staffId: $e');
      }
    }
  }

  void _changeWeek(int delta) async {
    _safeSetState(() {
      _weekStartDate = _weekStartDate.add(Duration(days: delta * 7));
      _isLoading = true;
    });
    await _loadSchedules();
    _safeSetState(() => _isLoading = false);
  }

  List<Map<String, dynamic>> get _assignmentsForDay {
    final List<Map<String, dynamic>> assignments = [];
    
    for (final staff in _staffProfiles) {
      final staffId = staff['id'];
      final schedule = _schedules[staffId];
      
      if (schedule == null) continue;
      
      final daySchedule = schedule[_selectedDay] as Map<String, dynamic>?;
      if (daySchedule == null) continue;
      
      final start = daySchedule['start'] as String?;
      final end = daySchedule['end'] as String?;
      final position = daySchedule['position'] as String?;
      final isOff = daySchedule['off'] == true;
      final isFeriado = daySchedule['feriado'] == true;
      
      if (isOff || isFeriado) continue;
      if (start == null || end == null || start.isEmpty || end.isEmpty) continue;
      
      assignments.add({
        'staffId': staffId,
        'staffName': '${staff['name'] ?? ''} ${staff['lastName'] ?? ''}'.trim(),
        'position': position ?? 'Sin posición',
        'start': start,
        'end': end,
        'modality': staff['modality'] ?? '',
      });
    }
    
    return assignments;
  }

  Map<String, List<Map<String, dynamic>>> get _assignmentsByPosition {
    final Map<String, List<Map<String, dynamic>>> byPosition = {};
    
    for (final assignment in _assignmentsForDay) {
      final position = assignment['position'] as String;
      byPosition.putIfAbsent(position, () => []);
      byPosition[position]!.add(assignment);
    }
    
    return byPosition;
  }

  @override
  Widget build(BuildContext context) {
    final weekEnd = _weekStartDate.add(const Duration(days: 6));
    final dateFormat = DateFormat('d MMM', 'es');

    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Posicionamiento Semanal'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.refreshCw),
            onPressed: _loadData,
            tooltip: 'Actualizar',
          ),
        ],
      ),
      body: Column(
        children: [
          // Navegación de semana
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  icon: const Icon(LucideIcons.chevronLeft),
                  onPressed: () => _changeWeek(-1),
                ),
                GestureDetector(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _weekStartDate,
                      firstDate: DateTime(2024),
                      lastDate: DateTime(2030),
                    );
                    if (picked != null && mounted) {
                      _safeSetState(() {
                        _weekStartDate = picked.subtract(Duration(days: picked.weekday - 1));
                        _isLoading = true;
                      });
                      await _loadSchedules();
                      _safeSetState(() => _isLoading = false);
                    }
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      gradient: AppTheme.primaryGradient,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(LucideIcons.calendar, color: Colors.white, size: 16),
                        const SizedBox(width: 8),
                        Text(
                          '${dateFormat.format(_weekStartDate)} - ${dateFormat.format(weekEnd)}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(LucideIcons.chevronRight),
                  onPressed: () => _changeWeek(1),
                ),
              ],
            ),
          ),

          // Selector de días
          Container(
            height: 56,
            color: Colors.white,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              itemCount: weekdayKeys.length,
              itemBuilder: (context, index) {
                final day = weekdayKeys[index];
                final isSelected = _selectedDay == day;
                final dayDate = _weekStartDate.add(Duration(days: index));
                final isToday = DateUtils.isSameDay(dayDate, DateTime.now());

                return GestureDetector(
                  onTap: () => _safeSetState(() => _selectedDay = day),
                  child: Container(
                    width: 52,
                    margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                    decoration: BoxDecoration(
                      gradient: isSelected ? AppTheme.primaryGradient : null,
                      color: isSelected ? null : (isToday ? AppTheme.primaryColor.withOpacity(0.1) : Colors.grey.shade100),
                      borderRadius: BorderRadius.circular(12),
                      border: isToday && !isSelected 
                          ? Border.all(color: AppTheme.primaryColor, width: 2)
                          : null,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          weekdayLabels[day]!,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: isSelected ? Colors.white : Colors.grey.shade700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          dayDate.day.toString(),
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: isSelected ? Colors.white : AppTheme.textPrimaryLight,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),

          const Divider(height: 1),

          // Contenido
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _buildContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    final byPosition = _assignmentsByPosition;
    
    if (byPosition.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                shape: BoxShape.circle,
              ),
              child: Icon(
                LucideIcons.calendarX,
                size: 48,
                color: Colors.grey.shade400,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'No hay asignaciones para ${weekdayLabelsFull[_selectedDay]}',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Colors.grey.shade600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Configura los horarios desde la web',
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey.shade400,
              ),
            ),
          ],
        ),
      );
    }

    final totalAssignments = _assignmentsForDay.length;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Resumen
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF6366F1).withOpacity(0.3),
                blurRadius: 15,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  LucideIcons.users,
                  color: Colors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 16),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$totalAssignments asignaciones',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    '${byPosition.keys.length} posiciones activas',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.white.withOpacity(0.8),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ).animate().fadeIn().scale(begin: const Offset(0.95, 0.95)),

        const SizedBox(height: 24),

        // Lista por posición
        ...byPosition.entries.map((entry) {
          return _PositionCard(
            position: entry.key,
            assignments: entry.value,
          ).animate().fadeIn().slideY(begin: 0.1, end: 0);
        }),
      ],
    );
  }
}

class _PositionCard extends StatelessWidget {
  final String position;
  final List<Map<String, dynamic>> assignments;

  const _PositionCard({
    required this.position,
    required this.assignments,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
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
          // Header de posición
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.primaryColor.withOpacity(0.05),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    LucideIcons.mapPin,
                    color: AppTheme.primaryColor,
                    size: 18,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        position,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.textPrimaryLight,
                        ),
                      ),
                      Text(
                        '${assignments.length} persona${assignments.length != 1 ? 's' : ''}',
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Lista de personas
          ...assignments.map((assignment) => Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: Colors.grey.shade100,
                  width: 1,
                ),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    gradient: AppTheme.primaryGradient,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Center(
                    child: Text(
                      (assignment['staffName'] ?? 'X')[0].toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        assignment['staffName'] ?? 'Sin nombre',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Row(
                        children: [
                          Icon(
                            LucideIcons.clock,
                            size: 14,
                            color: Colors.grey.shade500,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '${assignment['start'] ?? '?'} - ${assignment['end'] ?? '?'}',
                            style: TextStyle(
                              fontSize: 13,
                              color: Colors.grey.shade600,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Badge de modalidad
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: (assignment['modality'] ?? '').toString().toLowerCase().contains('full')
                        ? AppTheme.successColor.withOpacity(0.1)
                        : AppTheme.warningColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    (assignment['modality'] ?? '').toString().toLowerCase().contains('full') ? 'FT' : 'PT',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: (assignment['modality'] ?? '').toString().toLowerCase().contains('full')
                          ? AppTheme.successColor
                          : AppTheme.warningColor,
                    ),
                  ),
                ),
              ],
            ),
          )),
        ],
      ),
    );
  }
}
