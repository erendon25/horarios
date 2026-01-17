import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/providers/auth_provider.dart';

/// Función para cargar estadísticas (carga manual, no stream)
Future<Map<String, int>> loadStaffStats(String storeId) async {
  if (storeId.isEmpty) {
    return {'fulltime': 0, 'parttime': 0, 'total': 0};
  }
  
  final snapshot = await FirebaseFirestore.instance
      .collection('staff_profiles')
      .where('storeId', isEqualTo: storeId)
      .where('isActive', isEqualTo: true)
      .get();
  
  int fulltime = 0;
  int parttime = 0;
  
  for (var doc in snapshot.docs) {
    final data = doc.data();
    final modality = (data['modality'] ?? '').toString().toLowerCase();
    if (modality.contains('full')) {
      fulltime++;
    } else if (modality.contains('part')) {
      parttime++;
    } else {
      fulltime++;
    }
  }
  
  return {
    'fulltime': fulltime,
    'parttime': parttime,
    'total': fulltime + parttime,
  };
}

class StaffStatsCard extends ConsumerStatefulWidget {
  const StaffStatsCard({super.key});

  @override
  ConsumerState<StaffStatsCard> createState() => _StaffStatsCardState();
}

class _StaffStatsCardState extends ConsumerState<StaffStatsCard> {
  Map<String, int> _stats = {'fulltime': 0, 'parttime': 0, 'total': 0};
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final userData = await ref.read(userDataProvider.future);
    final storeId = userData?['storeId'] ?? '';
    
    if (storeId.isEmpty) {
      setState(() => _isLoading = false);
      return;
    }
    
    try {
      final stats = await loadStaffStats(storeId);
      setState(() {
        _stats = stats;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 15,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.primaryColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  LucideIcons.users,
                  color: AppTheme.primaryColor,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Resumen de Personal',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textPrimaryLight,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () {
                  setState(() => _isLoading = true);
                  _loadStats();
                },
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    LucideIcons.refreshCw,
                    size: 16,
                    color: _isLoading ? Colors.grey : AppTheme.primaryColor,
                  ),
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 20),
          
          _isLoading
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(20),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : Row(
                  children: [
                    Expanded(
                      child: _StatItem(
                        icon: LucideIcons.userCheck,
                        label: 'Full Time',
                        value: '${_stats['fulltime']}',
                        color: AppTheme.successColor,
                      ),
                    ),
                    Container(
                      width: 1,
                      height: 50,
                      color: Colors.grey.shade200,
                    ),
                    Expanded(
                      child: _StatItem(
                        icon: LucideIcons.timer,
                        label: 'Part Time',
                        value: '${_stats['parttime']}',
                        color: AppTheme.warningColor,
                      ),
                    ),
                    Container(
                      width: 1,
                      height: 50,
                      color: Colors.grey.shade200,
                    ),
                    Expanded(
                      child: _StatItem(
                        icon: LucideIcons.users,
                        label: 'Total',
                        value: '${_stats['total']}',
                        color: AppTheme.primaryColor,
                      ),
                    ),
                  ],
                ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _StatItem({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(icon, color: color, size: 22),
        const SizedBox(height: 8),
        Text(
          value,
          style: TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey.shade600,
          ),
        ),
      ],
    );
  }
}
