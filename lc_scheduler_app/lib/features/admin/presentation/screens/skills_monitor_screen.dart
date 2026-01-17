import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

/// Lista completa de skills disponibles en el sistema
const List<String> allAvailableSkills = [
  'caja',
  'almacen',
  'atencion_cliente',
  'reposicion',
  'limpieza',
  'inventario',
  'apertura',
  'cierre',
  'supervisor',
  'entrenamiento',
];

/// Función para cargar skills (carga manual, no stream)
Future<List<Map<String, dynamic>>> loadStaffSkills(String storeId) async {
  if (storeId.isEmpty) return [];
  
  final snapshot = await FirebaseFirestore.instance
      .collection('staff_profiles')
      .where('storeId', isEqualTo: storeId)
      .where('isActive', isEqualTo: true)
      .get();
  
  return snapshot.docs.map((doc) {
    final data = doc.data();
    final skills = List<String>.from(data['skills'] ?? []);
    final totalSkills = allAvailableSkills.length;
    final completedSkills = skills.length;
    final progressPercent = (completedSkills / totalSkills * 100).round();
    
    return {
      'id': doc.id,
      'uid': data['uid'],
      'name': data['name'] ?? '',
      'lastName': data['lastName'] ?? '',
      'fullName': '${data['name'] ?? ''} ${data['lastName'] ?? ''}'.trim(),
      'skills': skills,
      'totalSkills': totalSkills,
      'completedSkills': completedSkills,
      'progressPercent': progressPercent,
      'modality': data['modality'] ?? '',
      'missingSkills': allAvailableSkills.where((s) => !skills.contains(s)).toList(),
    };
  }).toList();
}

class SkillsMonitorScreen extends ConsumerStatefulWidget {
  const SkillsMonitorScreen({super.key});

  @override
  ConsumerState<SkillsMonitorScreen> createState() => _SkillsMonitorScreenState();
}

class _SkillsMonitorScreenState extends ConsumerState<SkillsMonitorScreen> {
  String _searchQuery = '';
  String _filterProgress = 'all';
  List<Map<String, dynamic>> _staffList = [];
  bool _isLoading = true;
  String _storeId = '';
  DateTime? _lastUpdate;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final userData = await ref.read(userDataProvider.future);
    _storeId = userData?['storeId'] ?? '';
    await _refreshData();
  }

  Future<void> _refreshData() async {
    setState(() => _isLoading = true);
    try {
      final data = await loadStaffSkills(_storeId);
      setState(() {
        _staffList = data;
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
        title: const Text('Monitoreo de Skills'),
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: _isLoading
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(LucideIcons.refreshCw),
            onPressed: _isLoading ? null : _refreshData,
            tooltip: 'Actualizar datos',
          ),
          IconButton(
            icon: const Icon(LucideIcons.filter),
            onPressed: _showFilterDialog,
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
                    onTap: _refreshData,
                    child: const Text(
                      'Actualizar',
                      style: TextStyle(fontSize: 12, color: AppTheme.primaryColor, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),

          // Resumen general
          _buildSummaryCard(),
          
          // Barra de búsqueda
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: TextField(
              onChanged: (value) => setState(() => _searchQuery = value),
              decoration: InputDecoration(
                hintText: 'Buscar colaborador...',
                prefixIcon: const Icon(LucideIcons.search, size: 20),
                filled: true,
                fillColor: Colors.grey.shade100,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          
          // Lista de colaboradores
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _buildList(),
          ),       
        ],
      ),
    );
  }

  Widget _buildList() {
    var filtered = _staffList.where((staff) {
      final nameMatch = staff['fullName']
          .toString()
          .toLowerCase()
          .contains(_searchQuery.toLowerCase());
      return nameMatch;
    }).toList();
    
    if (_filterProgress == 'incomplete') {
      filtered = filtered.where((s) => s['progressPercent'] < 100).toList();
    } else if (_filterProgress == 'complete') {
      filtered = filtered.where((s) => s['progressPercent'] >= 100).toList();
    }
    
    filtered.sort((a, b) => (a['progressPercent'] as int).compareTo(b['progressPercent'] as int));
    
    if (filtered.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(LucideIcons.userX, size: 64, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            Text('No se encontraron colaboradores', style: TextStyle(color: Colors.grey.shade500)),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _refreshData,
              icon: const Icon(LucideIcons.refreshCw, size: 18),
              label: const Text('Actualizar'),
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primaryColor, foregroundColor: Colors.white),
            ),
          ],
        ),
      );
    }
    
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: filtered.length,
      itemBuilder: (context, index) {
        return _StaffSkillCard(staff: filtered[index])
            .animate()
            .fadeIn(delay: Duration(milliseconds: index * 50))
            .slideX(begin: 0.05, end: 0);
      },
    );
  }

  Widget _buildSummaryCard() {
    if (_isLoading) {
      return Container(
        height: 120,
        margin: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.grey.shade200,
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Center(child: CircularProgressIndicator()),
      );
    }

    final total = _staffList.length;
    final complete = _staffList.where((s) => s['progressPercent'] >= 100).length;
    final avgProgress = total > 0
        ? (_staffList.fold<int>(0, (sum, s) => sum + (s['progressPercent'] as int)) / total).round()
        : 0;
    
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF6366F1).withValues(alpha: 0.3),
            blurRadius: 15,
            offset: const Offset(0, 8),
          ),
        ],
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
                child: const Icon(LucideIcons.award, color: Colors.white, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Progreso General',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                    Text(
                      '$complete de $total al 100%',
                      style: TextStyle(fontSize: 14, color: Colors.white.withValues(alpha: 0.8)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LinearProgressIndicator(
              value: avgProgress / 100,
              minHeight: 12,
              backgroundColor: Colors.white.withValues(alpha: 0.2),
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Promedio: $avgProgress%',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.9)),
          ),
        ],
      ),
    ).animate().fadeIn().scale(begin: const Offset(0.95, 0.95));
  }

  String _formatTime(DateTime dt) {
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  void _showFilterDialog() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Filtrar por progreso', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            _FilterOption(title: 'Todos', isSelected: _filterProgress == 'all', onTap: () {
              setState(() => _filterProgress = 'all');
              Navigator.pop(context);
            }),
            _FilterOption(title: 'Incompletos (< 100%)', isSelected: _filterProgress == 'incomplete', color: AppTheme.warningColor, onTap: () {
              setState(() => _filterProgress = 'incomplete');
              Navigator.pop(context);
            }),
            _FilterOption(title: 'Completos (100%)', isSelected: _filterProgress == 'complete', color: AppTheme.successColor, onTap: () {
              setState(() => _filterProgress = 'complete');
              Navigator.pop(context);
            }),
          ],
        ),
      ),
    );
  }
}

class _FilterOption extends StatelessWidget {
  final String title;
  final bool isSelected;
  final VoidCallback onTap;
  final Color? color;

  const _FilterOption({required this.title, required this.isSelected, required this.onTap, this.color});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: Container(
        width: 24, height: 24,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isSelected ? (color ?? AppTheme.primaryColor) : Colors.grey.shade200,
        ),
        child: isSelected ? const Icon(LucideIcons.check, color: Colors.white, size: 16) : null,
      ),
      title: Text(title, style: TextStyle(fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400, color: isSelected ? (color ?? AppTheme.primaryColor) : null)),
    );
  }
}

class _StaffSkillCard extends StatelessWidget {
  final Map<String, dynamic> staff;

  const _StaffSkillCard({required this.staff});

  @override
  Widget build(BuildContext context) {
    final progress = staff['progressPercent'] as int;
    final isComplete = progress >= 100;
    final missingSkills = List<String>.from(staff['missingSkills'] ?? []);
    
    Color progressColor;
    if (progress >= 100) {
      progressColor = AppTheme.successColor;
    } else if (progress >= 70) {
      progressColor = AppTheme.warningColor;
    } else {
      progressColor = AppTheme.errorColor;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: Container(
            width: 52, height: 52,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: isComplete ? [AppTheme.successColor, const Color(0xFF059669)] : [progressColor, progressColor.withValues(alpha: 0.7)],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Center(
              child: Text('$progress%', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
            ),
          ),
          title: Text(staff['fullName'], style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 4),
              Text('${staff['completedSkills']} de ${staff['totalSkills']} skills', style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(value: progress / 100, minHeight: 6, backgroundColor: Colors.grey.shade200, valueColor: AlwaysStoppedAnimation<Color>(progressColor)),
              ),
            ],
          ),
          children: [
            if (missingSkills.isNotEmpty) ...[
              const Divider(),
              const SizedBox(height: 8),
              Row(children: [
                Icon(LucideIcons.alertCircle, size: 16, color: Colors.orange.shade600),
                const SizedBox(width: 8),
                const Text('Skills faltantes:', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              ]),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: missingSkills.map((skill) {
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.errorColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.errorColor.withValues(alpha: 0.3)),
                  ),
                  child: Text(_formatSkillName(skill), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: AppTheme.errorColor)),
                );
              }).toList()),
            ] else ...[
              const Divider(),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: AppTheme.successColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(LucideIcons.checkCircle, size: 18, color: AppTheme.successColor),
                  const SizedBox(width: 8),
                  Text('¡Todos los skills completados!', style: TextStyle(fontWeight: FontWeight.w600, color: AppTheme.successColor)),
                ]),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatSkillName(String skill) {
    return skill.replaceAll('_', ' ').split(' ').map((w) => w.isNotEmpty ? '${w[0].toUpperCase()}${w.substring(1)}' : '').join(' ');
  }
}
