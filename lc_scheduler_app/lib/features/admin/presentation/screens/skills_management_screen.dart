import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/models/staff_profile.dart';
import '../../../auth/data/providers/auth_provider.dart';

class SkillsManagementScreen extends ConsumerStatefulWidget {
  const SkillsManagementScreen({super.key});

  @override
  ConsumerState<SkillsManagementScreen> createState() => _SkillsManagementScreenState();
}

class _SkillsManagementScreenState extends ConsumerState<SkillsManagementScreen> {
  List<StaffProfile> _staffList = [];
  Set<String> _allSkills = {};
  String _storeId = '';
  bool _isLoading = true;
  String? _selectedSkill;
  bool _showWithoutSkills = false;

  @override
  void initState() {
    super.initState();
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

      final staffQuery = await FirebaseFirestore.instance
          .collection('staff_profiles')
          .where('storeId', isEqualTo: _storeId)
          .get();

      final staffList = staffQuery.docs
          .map((doc) => StaffProfile.fromMap(doc.data(), doc.id))
          .toList();

      // Recopilar todos los skills únicos
      final allSkills = <String>{};
      for (final staff in staffList) {
        allSkills.addAll(staff.skills);
      }

      if (mounted) {
        setState(() {
          _staffList = staffList;
          _allSkills = allSkills;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  List<StaffProfile> get _filteredStaff {
    if (_showWithoutSkills) {
      return _staffList.where((s) => s.skills.isEmpty).toList();
    }
    if (_selectedSkill != null) {
      return _staffList.where((s) => s.skills.contains(_selectedSkill)).toList();
    }
    return _staffList;
  }

  int _staffWithSkill(String skill) {
    return _staffList.where((s) => s.skills.contains(skill)).length;
  }

  int get _staffWithoutSkills {
    return _staffList.where((s) => s.skills.isEmpty).length;
  }

  Future<void> _toggleSkillForStaff(StaffProfile staff, String skill) async {
    final List<String> newSkills = List.from(staff.skills);
    
    if (newSkills.contains(skill)) {
      newSkills.remove(skill);
    } else {
      newSkills.add(skill);
    }

    try {
      await FirebaseFirestore.instance
          .collection('staff_profiles')
          .doc(staff.id)
          .update({'skills': newSkills});

      // Actualizar localmente
      _loadData();
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(newSkills.contains(skill) 
              ? 'Skill "$skill" agregado a ${staff.name}'
              : 'Skill "$skill" removido de ${staff.name}'),
          backgroundColor: AppTheme.successColor,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error: $e'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
    }
  }

  void _showAddSkillDialog() {
    final controller = TextEditingController();
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nuevo Skill'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Nombre del skill',
            hintText: 'Ej: Caja, Inventario, Atención',
          ),
          textCapitalization: TextCapitalization.words,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              final newSkill = controller.text.trim();
              if (newSkill.isNotEmpty) {
                setState(() => _allSkills.add(newSkill));
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

  void _showStaffSkillsModal(StaffProfile staff) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) => Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
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
                        staff.name.isNotEmpty ? staff.name[0].toUpperCase() : '?',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
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
                          staff.fullName,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          '${staff.skills.length} skills asignados',
                          style: TextStyle(color: Colors.grey.shade600),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Text(
                'Skills Disponibles',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  children: _allSkills.map((skill) {
                    final hasSkill = staff.skills.contains(skill);
                    return ListTile(
                      leading: Icon(
                        hasSkill ? LucideIcons.checkSquare : LucideIcons.square,
                        color: hasSkill ? AppTheme.successColor : Colors.grey,
                      ),
                      title: Text(skill),
                      trailing: hasSkill
                          ? const Icon(LucideIcons.star, color: AppTheme.warningColor, size: 18)
                          : null,
                      onTap: () async {
                        await _toggleSkillForStaff(staff, skill);
                        Navigator.pop(context);
                      },
                    );
                  }).toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundLight,
      appBar: AppBar(
        title: const Text('Gestión de Skills'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.plus),
            onPressed: _showAddSkillDialog,
            tooltip: 'Agregar skill',
          ),
          IconButton(
            icon: const Icon(LucideIcons.refreshCw),
            onPressed: _loadData,
            tooltip: 'Actualizar',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Filtros de skills
                Container(
                  height: 50,
                  color: Colors.white,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    children: [
                      // Chip "Todos"
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                        child: ChoiceChip(
                          label: Text('Todos (${_staffList.length})'),
                          selected: _selectedSkill == null && !_showWithoutSkills,
                          onSelected: (_) => setState(() {
                            _selectedSkill = null;
                            _showWithoutSkills = false;
                          }),
                          selectedColor: AppTheme.primaryColor,
                          labelStyle: TextStyle(
                            color: (_selectedSkill == null && !_showWithoutSkills) ? Colors.white : null,
                          ),
                        ),
                      ),
                      // Chip "Sin skills"
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                        child: ChoiceChip(
                          label: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                LucideIcons.alertCircle,
                                size: 14,
                                color: _showWithoutSkills ? Colors.white : AppTheme.errorColor,
                              ),
                              const SizedBox(width: 4),
                              Text('Sin skills ($_staffWithoutSkills)'),
                            ],
                          ),
                          selected: _showWithoutSkills,
                          onSelected: (_) => setState(() {
                            _selectedSkill = null;
                            _showWithoutSkills = true;
                          }),
                          selectedColor: AppTheme.errorColor,
                          labelStyle: TextStyle(
                            color: _showWithoutSkills ? Colors.white : null,
                          ),
                        ),
                      ),
                      // Chips por skill
                      ..._allSkills.map((skill) {
                        final count = _staffWithSkill(skill);
                        final isSelected = _selectedSkill == skill;
                        return Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                          child: ChoiceChip(
                            label: Text('$skill ($count)'),
                            selected: isSelected,
                            onSelected: (_) => setState(() {
                              _selectedSkill = skill;
                              _showWithoutSkills = false;
                            }),
                            selectedColor: AppTheme.primaryColor,
                            labelStyle: TextStyle(
                              color: isSelected ? Colors.white : null,
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ),

                const Divider(height: 1),

                // Header con info
                if (_selectedSkill != null || _showWithoutSkills)
                  Container(
                    padding: const EdgeInsets.all(16),
                    color: (_showWithoutSkills ? AppTheme.errorColor : AppTheme.primaryColor).withOpacity(0.1),
                    child: Row(
                      children: [
                        Icon(
                          _showWithoutSkills ? LucideIcons.alertCircle : LucideIcons.star,
                          color: _showWithoutSkills ? AppTheme.errorColor : AppTheme.primaryColor,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _showWithoutSkills 
                                    ? 'Personal sin skills asignados' 
                                    : 'Personal con skill: $_selectedSkill',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                '${_filteredStaff.length} colaborador${_filteredStaff.length != 1 ? 'es' : ''}',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.grey.shade600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        TextButton(
                          onPressed: () => setState(() {
                            _selectedSkill = null;
                            _showWithoutSkills = false;
                          }),
                          child: const Text('Ver todos'),
                        ),
                      ],
                    ),
                  ),

                // Lista de personal
                Expanded(
                  child: _filteredStaff.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                LucideIcons.users,
                                size: 48,
                                color: Colors.grey.shade300,
                              ),
                              const SizedBox(height: 16),
                              Text(
                                'No hay personal en esta categoría',
                                style: TextStyle(color: Colors.grey.shade500),
                              ),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _loadData,
                          child: ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: _filteredStaff.length,
                            itemBuilder: (context, index) {
                              final staff = _filteredStaff[index];
                              return _SkillStaffCard(
                                staff: staff,
                                onTap: () => _showStaffSkillsModal(staff),
                              ).animate().fadeIn(delay: Duration(milliseconds: index * 30));
                            },
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}

class _SkillStaffCard extends StatelessWidget {
  final StaffProfile staff;
  final VoidCallback onTap;

  const _SkillStaffCard({required this.staff, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: staff.skills.isEmpty
                        ? LinearGradient(colors: [Colors.grey.shade400, Colors.grey.shade500])
                        : AppTheme.primaryGradient,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Text(
                      staff.name.isNotEmpty ? staff.name[0].toUpperCase() : '?',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
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
                        staff.fullName,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        staff.isFullTime ? 'Full Time' : 'Part Time',
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: staff.skills.isEmpty 
                        ? AppTheme.errorColor.withOpacity(0.1)
                        : AppTheme.primaryColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    staff.skills.isEmpty ? 'Sin skills' : '${staff.skills.length} skills',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: staff.skills.isEmpty ? AppTheme.errorColor : AppTheme.primaryColor,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(LucideIcons.chevronRight, color: Colors.grey),
              ],
            ),
            if (staff.skills.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: staff.skills.map((skill) {
                  return Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.successColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.successColor.withOpacity(0.3)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(LucideIcons.star, size: 12, color: AppTheme.successColor),
                        const SizedBox(width: 4),
                        Text(
                          skill,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppTheme.successColor,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
