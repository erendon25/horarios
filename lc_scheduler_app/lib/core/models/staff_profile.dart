import 'package:cloud_firestore/cloud_firestore.dart';

/// Modelo de perfil de personal con skills y horarios
class StaffProfile {
  final String id;
  final String uid;
  final String name;
  final String? lastName;
  final String? email;
  final String? dni;
  final String? storeId;
  final String modality; // 'fulltime' o 'parttime'
  final List<String> skills; // Áreas que sabe hacer bien
  final List<String> positionAbilities; // Posiciones habilitadas
  final DateTime? carnetExpiration;
  final DateTime? sanitaryCardDate; // Fecha de vencimiento del carnet de sanidad
  final bool isActive;
  
  const StaffProfile({
    required this.id,
    required this.uid,
    required this.name,
    this.lastName,
    this.email,
    this.dni,
    this.storeId,
    this.modality = 'fulltime',
    this.skills = const [],
    this.positionAbilities = const [],
    this.carnetExpiration,
    this.sanitaryCardDate,
    this.isActive = true,
  });
  
  factory StaffProfile.fromMap(Map<String, dynamic> map, String id) {
    // Parse sanitaryCardDate from various formats
    DateTime? parseSanitaryCard() {
      final value = map['sanitaryCardDate'];
      if (value == null) return null;
      if (value is Timestamp) return value.toDate();
      if (value is String && value.isNotEmpty) return DateTime.tryParse(value);
      return null;
    }
    
    // Parse carnetExpiration from various formats
    DateTime? parseCarnetExpiration() {
      final value = map['carnetExpiration'];
      if (value == null) return null;
      if (value is Timestamp) return value.toDate();
      if (value is String && value.isNotEmpty) return DateTime.tryParse(value);
      return null;
    }
    
    return StaffProfile(
      id: id,
      uid: map['uid'] ?? '',
      name: map['name'] ?? '',
      lastName: map['lastName'],
      email: map['email'],
      dni: map['dni'],
      storeId: map['storeId'],
      modality: map['modality'] ?? 'fulltime',
      skills: List<String>.from(map['skills'] ?? []),
      positionAbilities: List<String>.from(map['positionAbilities'] ?? []),
      carnetExpiration: parseCarnetExpiration(),
      sanitaryCardDate: parseSanitaryCard(),
      isActive: map['isActive'] ?? true,
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'name': name,
      'lastName': lastName,
      'email': email,
      'dni': dni,
      'storeId': storeId,
      'modality': modality,
      'skills': skills,
      'positionAbilities': positionAbilities,
      'carnetExpiration': carnetExpiration?.toIso8601String(),
      'sanitaryCardDate': sanitaryCardDate?.toIso8601String(),
      'isActive': isActive,
    };
  }
  
  String get fullName => '${name} ${lastName ?? ''}'.trim();
  
  bool get isFullTime => modality.toLowerCase().contains('full');
  bool get isPartTime => modality.toLowerCase().contains('part');
  
  /// Fecha efectiva del carnet (usa sanitaryCardDate o carnetExpiration)
  DateTime? get effectiveCarnetDate => sanitaryCardDate ?? carnetExpiration;
  
  /// Verifica si el carnet está vencido
  bool get isCarnetExpired {
    final date = effectiveCarnetDate;
    if (date == null) return false;
    return date.isBefore(DateTime.now());
  }
  
  /// Verifica si el carnet está por vencer (próximos 30 días)
  bool get isCarnetExpiringSoon {
    final date = effectiveCarnetDate;
    if (date == null) return false;
    final thirtyDaysFromNow = DateTime.now().add(const Duration(days: 30));
    return date.isAfter(DateTime.now()) && date.isBefore(thirtyDaysFromNow);
  }
  
  /// Verifica si tiene un skill específico
  bool hasSkill(String skill) => skills.contains(skill);
  
  /// Verifica si puede intercambiar con otro colaborador (mismos skills)
  bool canSwapWith(StaffProfile other) {
    if (skills.isEmpty || other.skills.isEmpty) return false;
    return skills.any((skill) => other.skills.contains(skill));
  }
  
  StaffProfile copyWith({
    String? id,
    String? uid,
    String? name,
    String? lastName,
    String? email,
    String? dni,
    String? storeId,
    String? modality,
    List<String>? skills,
    List<String>? positionAbilities,
    DateTime? carnetExpiration,
    DateTime? sanitaryCardDate,
    bool? isActive,
  }) {
    return StaffProfile(
      id: id ?? this.id,
      uid: uid ?? this.uid,
      name: name ?? this.name,
      lastName: lastName ?? this.lastName,
      email: email ?? this.email,
      dni: dni ?? this.dni,
      storeId: storeId ?? this.storeId,
      modality: modality ?? this.modality,
      skills: skills ?? this.skills,
      positionAbilities: positionAbilities ?? this.positionAbilities,
      carnetExpiration: carnetExpiration ?? this.carnetExpiration,
      sanitaryCardDate: sanitaryCardDate ?? this.sanitaryCardDate,
      isActive: isActive ?? this.isActive,
    );
  }
}
