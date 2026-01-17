import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

/// Lista de skills disponibles en el sistema
const List<Map<String, dynamic>> availableSkills = [
  {'id': 'caja', 'name': 'Caja', 'icon': LucideIcons.creditCard, 'color': Color(0xFF3B82F6)},
  {'id': 'almacen', 'name': 'Almacén', 'icon': LucideIcons.warehouse, 'color': Color(0xFFF59E0B)},
  {'id': 'atencion_cliente', 'name': 'Atención al Cliente', 'icon': LucideIcons.headphones, 'color': Color(0xFF10B981)},
  {'id': 'reposicion', 'name': 'Reposición', 'icon': LucideIcons.packageCheck, 'color': Color(0xFF8B5CF6)},
  {'id': 'limpieza', 'name': 'Limpieza', 'icon': LucideIcons.sparkles, 'color': Color(0xFF06B6D4)},
  {'id': 'inventario', 'name': 'Inventario', 'icon': LucideIcons.clipboardList, 'color': Color(0xFFEC4899)},
  {'id': 'apertura', 'name': 'Apertura', 'icon': LucideIcons.keyRound, 'color': Color(0xFF14B8A6)},
  {'id': 'cierre', 'name': 'Cierre', 'icon': LucideIcons.lock, 'color': Color(0xFFEF4444)},
  {'id': 'supervisor', 'name': 'Supervisor', 'icon': LucideIcons.userCheck, 'color': Color(0xFF6366F1)},
  {'id': 'entrenamiento', 'name': 'Entrenamiento', 'icon': LucideIcons.graduationCap, 'color': Color(0xFFA855F7)},
];

class SkillsScreen extends ConsumerStatefulWidget {
  const SkillsScreen({super.key});

  @override
  ConsumerState<SkillsScreen> createState() => _SkillsScreenState();
}

class _SkillsScreenState extends ConsumerState<SkillsScreen> {
  List<String> _selectedSkills = [];
  bool _isLoading = true;
  bool _isSaving = false;
  String? _staffProfileId;

  @override
  void initState() {
    super.initState();
    _loadCurrentSkills();
  }

  Future<void> _loadCurrentSkills() async {
    final staffProfile = await ref.read(currentStaffProfileProvider.future);
    
    if (staffProfile != null) {
      setState(() {
        _staffProfileId = staffProfile['id'] as String?;
        _selectedSkills = List<String>.from(staffProfile['skills'] ?? []);
        _isLoading = false;
      });
    } else {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _saveSkills() async {
    if (_staffProfileId == null) return;

    setState(() => _isSaving = true);

    try {
      await FirebaseFirestore.instance
          .collection('staff_profiles')
          .doc(_staffProfileId)
          .update({'skills': _selectedSkills});

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Skills guardados correctamente'),
            backgroundColor: AppTheme.successColor,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al guardar: $e'),
            backgroundColor: AppTheme.errorColor,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  void _toggleSkill(String skillId) {
    setState(() {
      if (_selectedSkills.contains(skillId)) {
        _selectedSkills.remove(skillId);
      } else {
        _selectedSkills.add(skillId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Mis Skills'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          if (!_isLoading)
            TextButton.icon(
              onPressed: _isSaving ? null : _saveSkills,
              icon: _isSaving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(LucideIcons.save, size: 18),
              label: Text(_isSaving ? 'Guardando...' : 'Guardar'),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
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
                          AppTheme.primaryColor.withOpacity(0.1),
                          AppTheme.secondaryColor.withOpacity(0.1),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: AppTheme.primaryColor.withOpacity(0.2),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppTheme.primaryColor.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(
                            LucideIcons.info,
                            color: AppTheme.primaryColor,
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 14),
                        const Expanded(
                          child: Text(
                            'Selecciona las áreas en las que tienes experiencia. Esto te permitirá intercambiar horarios con compañeros que tengan skills similares.',
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

                  // Contador
                  Row(
                    children: [
                      const Icon(
                        LucideIcons.award,
                        color: AppTheme.primaryColor,
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '${_selectedSkills.length} skills seleccionados',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimaryLight,
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 16),

                  // Grid de skills
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 1.5,
                    ),
                    itemCount: availableSkills.length,
                    itemBuilder: (context, index) {
                      final skill = availableSkills[index];
                      final isSelected = _selectedSkills.contains(skill['id']);

                      return _SkillCard(
                        name: skill['name'],
                        icon: skill['icon'],
                        color: skill['color'],
                        isSelected: isSelected,
                        onTap: () => _toggleSkill(skill['id']),
                      )
                          .animate()
                          .fadeIn(delay: Duration(milliseconds: 50 * index))
                          .scale(begin: const Offset(0.9, 0.9));
                    },
                  ),

                  const SizedBox(height: 24),

                  // Botón guardar (móvil)
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton.icon(
                      onPressed: _isSaving ? null : _saveSkills,
                      icon: _isSaving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(LucideIcons.save),
                      label: Text(_isSaving ? 'Guardando...' : 'Guardar Cambios'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primaryColor,
                        foregroundColor: Colors.white,
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

class _SkillCard extends StatelessWidget {
  final String name;
  final IconData icon;
  final Color color;
  final bool isSelected;
  final VoidCallback onTap;

  const _SkillCard({
    required this.name,
    required this.icon,
    required this.color,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isSelected ? color.withOpacity(0.15) : Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isSelected ? color : Colors.grey.shade200,
              width: isSelected ? 2 : 1,
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: color.withOpacity(0.2),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: color.withOpacity(isSelected ? 0.2 : 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      icon,
                      color: color,
                      size: 20,
                    ),
                  ),
                  if (isSelected)
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        LucideIcons.check,
                        color: Colors.white,
                        size: 14,
                      ),
                    ),
                ],
              ),
              Text(
                name,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: isSelected ? color : AppTheme.textPrimaryLight,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
