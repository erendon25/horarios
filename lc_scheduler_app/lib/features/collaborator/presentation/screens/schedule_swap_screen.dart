import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

class ScheduleSwapScreen extends ConsumerStatefulWidget {
  const ScheduleSwapScreen({super.key});

  @override
  ConsumerState<ScheduleSwapScreen> createState() => _ScheduleSwapScreenState();
}

class _ScheduleSwapScreenState extends ConsumerState<ScheduleSwapScreen> {
  String? _selectedDay;
  String? _selectedTargetId;
  String? _myShift;
  String? _targetShift;
  bool _isLoading = false;
  List<Map<String, dynamic>> _compatibleStaff = [];
  Map<String, dynamic>? _myProfile;

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
    _loadMyProfile();
  }

  Future<void> _loadMyProfile() async {
    final profile = await ref.read(currentStaffProfileProvider.future);
    if (profile != null) {
      setState(() => _myProfile = profile);
    }
  }

  /// Verifica si dos modalidades son la misma (full↔full, part↔part)
  bool _isSameModality(String mod1, String mod2) {
    final isFullTime1 = mod1.contains('full');
    final isFullTime2 = mod2.contains('full');
    return isFullTime1 == isFullTime2;
  }

  Future<void> _loadCompatibleStaff() async {
    if (_selectedDay == null || _myProfile == null) return;

    setState(() {
      _isLoading = true;
      _compatibleStaff = [];
    });

    try {
      final mySkills = List<String>.from(_myProfile!['skills'] ?? []);
      final myStoreId = _myProfile!['storeId'];
      final myUid = _myProfile!['uid'];

      // Obtener mi horario del día seleccionado
      final myScheduleSnap = await FirebaseFirestore.instance
          .collection('schedules')
          .where('staffId', isEqualTo: myUid)
          .where('dayOfWeek', isEqualTo: _selectedDay)
          .limit(1)
          .get();

      if (myScheduleSnap.docs.isEmpty) {
        setState(() {
          _myShift = null;
          _isLoading = false;
        });
        return;
      }

      final myScheduleData = myScheduleSnap.docs.first.data();
      _myShift = '${myScheduleData['start'] ?? '?'} - ${myScheduleData['end'] ?? '?'}';

      // Obtener todos los staff de la misma tienda
      final staffSnap = await FirebaseFirestore.instance
          .collection('staff_profiles')
          .where('storeId', isEqualTo: myStoreId)
          .where('isActive', isEqualTo: true)
          .get();

      // Obtener mi modalidad (fulltime/parttime)
      final myModality = (_myProfile!['modality'] ?? '').toString().toLowerCase();

      // Filtrar por modalidad Y skills compatibles
      final compatible = <Map<String, dynamic>>[];

      for (var doc in staffSnap.docs) {
        final data = doc.data();
        if (data['uid'] == myUid) continue; // Excluirme a mí

        final staffModality = (data['modality'] ?? '').toString().toLowerCase();
        final staffSkills = List<String>.from(data['skills'] ?? []);
        
        // REGLA 1: Misma modalidad (Full con Full, Part con Part)
        final sameModality = _isSameModality(myModality, staffModality);
        
        // REGLA 2: Al menos un skill en común
        final hasCommonSkill = mySkills.any((s) => staffSkills.contains(s));
        
        // Solo es compatible si cumple AMBAS condiciones
        if (sameModality && (hasCommonSkill || mySkills.isEmpty)) {
          // Obtener su horario del día
          final theirScheduleSnap = await FirebaseFirestore.instance
              .collection('schedules')
              .where('staffId', isEqualTo: data['uid'])
              .where('dayOfWeek', isEqualTo: _selectedDay)
              .limit(1)
              .get();

          String? theirShift;
          if (theirScheduleSnap.docs.isNotEmpty) {
            final theirData = theirScheduleSnap.docs.first.data();
            theirShift = '${theirData['start'] ?? '?'} - ${theirData['end'] ?? '?'}';
          }

          compatible.add({
            'id': doc.id,
            'uid': data['uid'],
            'name': data['name'] ?? '',
            'lastName': data['lastName'] ?? '',
            'skills': staffSkills,
            'shift': theirShift,
            'modality': staffModality,
          });
        }
      }

      setState(() {
        _compatibleStaff = compatible;
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

  Future<void> _submitSwapRequest() async {
    if (_selectedTargetId == null || _myProfile == null || _selectedDay == null) {
      return;
    }

    final target = _compatibleStaff.firstWhere((s) => s['uid'] == _selectedTargetId);

    try {
      setState(() => _isLoading = true);

      await FirebaseFirestore.instance.collection('swap_requests').add({
        'requesterId': _myProfile!['uid'],
        'requesterName': '${_myProfile!['name']} ${_myProfile!['lastName'] ?? ''}'.trim(),
        'targetId': target['uid'],
        'targetName': '${target['name']} ${target['lastName'] ?? ''}'.trim(),
        'date': DateTime.now().toIso8601String(), // Fecha de la solicitud
        'dayOfWeek': _selectedDay,
        'requesterShift': _myShift ?? 'N/A',
        'targetShift': target['shift'] ?? 'N/A',
        'storeId': _myProfile!['storeId'],
        'status': 'pending',
        'createdAt': DateTime.now().toIso8601String(),
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Solicitud enviada correctamente'),
            backgroundColor: AppTheme.successColor,
          ),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.errorColor),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Solicitar Cambio'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Información
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.warningColor.withOpacity(0.1),
                    AppTheme.warningColor.withOpacity(0.05),
                  ],
                ),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: AppTheme.warningColor.withOpacity(0.3),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppTheme.warningColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      LucideIcons.alertTriangle,
                      color: AppTheme.warningColor,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Text(
                      'Solo puedes intercambiar con compañeros de tu misma modalidad (Full ↔ Full, Part ↔ Part) y que compartan tus skills. La solicitud debe ser aprobada por un administrador.',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondaryLight,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ).animate().fadeIn().slideY(begin: -0.1, end: 0),

            const SizedBox(height: 24),

            // Paso 1: Seleccionar día
            _SectionTitle(
              number: '1',
              title: 'Selecciona el día',
            ),

            const SizedBox(height: 12),

            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _weekDays.map((day) {
                final isSelected = _selectedDay == day['key'];
                return FilterChip(
                  label: Text(day['label']!),
                  selected: isSelected,
                  onSelected: (selected) {
                    setState(() {
                      _selectedDay = selected ? day['key'] : null;
                      _selectedTargetId = null;
                      _compatibleStaff = [];
                    });
                    if (selected) _loadCompatibleStaff();
                  },
                  selectedColor: AppTheme.primaryColor.withOpacity(0.15),
                  checkmarkColor: AppTheme.primaryColor,
                  labelStyle: TextStyle(
                    color: isSelected ? AppTheme.primaryColor : AppTheme.textPrimaryLight,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                  ),
                );
              }).toList(),
            ),

            if (_selectedDay != null && _myShift != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppTheme.primaryColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(
                      LucideIcons.clock,
                      color: AppTheme.primaryColor,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Tu horario: $_myShift',
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        color: AppTheme.primaryColor,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 24),

            // Paso 2: Seleccionar compañero
            _SectionTitle(
              number: '2',
              title: 'Selecciona compañero',
            ),

            const SizedBox(height: 12),

            if (_isLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(30),
                  child: CircularProgressIndicator(),
                ),
              )
            else if (_selectedDay == null)
              Container(
                padding: const EdgeInsets.all(30),
                child: Center(
                  child: Text(
                    'Selecciona un día primero',
                    style: TextStyle(color: Colors.grey.shade500),
                  ),
                ),
              )
            else if (_compatibleStaff.isEmpty)
              Container(
                padding: const EdgeInsets.all(30),
                decoration: BoxDecoration(
                  color: Colors.grey.shade50,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  children: [
                    Icon(
                      LucideIcons.userMinus,
                      size: 40,
                      color: Colors.grey.shade400,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'No hay compañeros compatibles',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: Colors.grey.shade600,
                      ),
                    ),
                  ],
                ),
              )
            else
              ...List.generate(_compatibleStaff.length, (index) {
                final staff = _compatibleStaff[index];
                final isSelected = _selectedTargetId == staff['uid'];

                return GestureDetector(
                  onTap: () {
                    setState(() {
                      _selectedTargetId = staff['uid'];
                      _targetShift = staff['shift'];
                    });
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? AppTheme.primaryColor.withOpacity(0.1)
                          : Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: isSelected
                            ? AppTheme.primaryColor
                            : Colors.grey.shade200,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            gradient: AppTheme.primaryGradient,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Center(
                            child: Text(
                              (staff['name'] as String)[0].toUpperCase(),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${staff['name']} ${staff['lastName'] ?? ''}'.trim(),
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              if (staff['shift'] != null)
                                Text(
                                  'Horario: ${staff['shift']}',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: Colors.grey.shade600,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        if (isSelected)
                          Container(
                            padding: const EdgeInsets.all(6),
                            decoration: const BoxDecoration(
                              color: AppTheme.primaryColor,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              LucideIcons.check,
                              color: Colors.white,
                              size: 16,
                            ),
                          ),
                      ],
                    ),
                  ).animate().fadeIn(delay: Duration(milliseconds: 50 * index)),
                );
              }),

            const SizedBox(height: 32),

            // Botón enviar
            SizedBox(
              width: double.infinity,
              height: 54,
              child: ElevatedButton.icon(
                onPressed: _selectedTargetId != null && !_isLoading
                    ? _submitSwapRequest
                    : null,
                icon: _isLoading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(LucideIcons.send),
                label: const Text('Enviar Solicitud'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryColor,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.grey.shade300,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String number;
  final String title;

  const _SectionTitle({required this.number, required this.title});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            gradient: AppTheme.primaryGradient,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              number,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          title,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: AppTheme.textPrimaryLight,
          ),
        ),
      ],
    );
  }
}
