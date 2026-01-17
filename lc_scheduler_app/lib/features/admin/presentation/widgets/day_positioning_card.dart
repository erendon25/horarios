import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';

class DayPositioningCard extends StatelessWidget {
  final String dayName;
  final String dayKey;
  final VoidCallback onTap;

  const DayPositioningCard({
    super.key,
    required this.dayName,
    required this.dayKey,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // Colores específicos para cada día
    final dayColors = {
      'monday': const Color(0xFF3B82F6),
      'tuesday': const Color(0xFF8B5CF6),
      'wednesday': const Color(0xFF10B981),
      'thursday': const Color(0xFFF59E0B),
      'friday': const Color(0xFFEF4444),
      'saturday': const Color(0xFF06B6D4),
      'sunday': const Color(0xFFEC4899),
    };
    
    final color = dayColors[dayKey] ?? AppTheme.primaryColor;
    
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: Colors.grey.shade200,
              width: 1,
            ),
            boxShadow: [
              BoxShadow(
                color: color.withOpacity(0.08),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              // Indicador de color del día
              Container(
                width: 4,
                height: 50,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(width: 16),
              
              // Icono del día
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  LucideIcons.calendar,
                  color: color,
                  size: 22,
                ),
              ),
              const SizedBox(width: 16),
              
              // Nombre del día
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      dayName,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.textPrimaryLight,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Ver posicionamiento',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey.shade500,
                      ),
                    ),
                  ],
                ),
              ),
              
              // Flecha
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  LucideIcons.chevronRight,
                  color: Colors.grey.shade600,
                  size: 20,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
