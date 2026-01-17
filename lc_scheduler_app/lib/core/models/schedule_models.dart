/// Modelo para horarios de estudio de los colaboradores
class StudySchedule {
  final String id;
  final String uid;
  final String dayOfWeek; // monday, tuesday, etc.
  final String startTime; // HH:mm
  final String endTime; // HH:mm
  final String? subject; // Materia o descripción
  final String? institution; // Universidad/Instituto
  final bool isActive;
  
  const StudySchedule({
    required this.id,
    required this.uid,
    required this.dayOfWeek,
    required this.startTime,
    required this.endTime,
    this.subject,
    this.institution,
    this.isActive = true,
  });
  
  factory StudySchedule.fromMap(Map<String, dynamic> map, String id) {
    return StudySchedule(
      id: id,
      uid: map['uid'] ?? '',
      dayOfWeek: map['dayOfWeek'] ?? '',
      startTime: map['startTime'] ?? '',
      endTime: map['endTime'] ?? '',
      subject: map['subject'],
      institution: map['institution'],
      isActive: map['isActive'] ?? true,
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'dayOfWeek': dayOfWeek,
      'startTime': startTime,
      'endTime': endTime,
      'subject': subject,
      'institution': institution,
      'isActive': isActive,
    };
  }
  
  String get dayLabel {
    const labels = {
      'monday': 'Lunes',
      'tuesday': 'Martes',
      'wednesday': 'Miércoles',
      'thursday': 'Jueves',
      'friday': 'Viernes',
      'saturday': 'Sábado',
      'sunday': 'Domingo',
    };
    return labels[dayOfWeek.toLowerCase()] ?? dayOfWeek;
  }
  
  String get timeRange => '$startTime - $endTime';
}

/// Modelo para el horario de trabajo asignado
class WorkSchedule {
  final String id;
  final String staffId;
  final String staffName;
  final String date; // YYYY-MM-DD
  final String dayOfWeek;
  final String startTime; // HH:mm
  final String endTime; // HH:mm
  final String position;
  final String? storeId;
  final bool isOffDay; // Día libre
  
  const WorkSchedule({
    required this.id,
    required this.staffId,
    required this.staffName,
    required this.date,
    required this.dayOfWeek,
    required this.startTime,
    required this.endTime,
    required this.position,
    this.storeId,
    this.isOffDay = false,
  });
  
  factory WorkSchedule.fromMap(Map<String, dynamic> map, String id) {
    return WorkSchedule(
      id: id,
      staffId: map['staffId'] ?? map['uid'] ?? '',
      staffName: map['staffName'] ?? map['name'] ?? '',
      date: map['date'] ?? '',
      dayOfWeek: map['dayOfWeek'] ?? '',
      startTime: map['start'] ?? map['startTime'] ?? '',
      endTime: map['end'] ?? map['endTime'] ?? '',
      position: map['position'] ?? '',
      storeId: map['storeId'],
      isOffDay: map['isOffDay'] ?? map['dayOff'] ?? false,
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'staffId': staffId,
      'staffName': staffName,
      'date': date,
      'dayOfWeek': dayOfWeek,
      'startTime': startTime,
      'endTime': endTime,
      'position': position,
      'storeId': storeId,
      'isOffDay': isOffDay,
    };
  }
  
  String get timeRange => isOffDay ? 'Día libre' : '$startTime - $endTime';
  
  String get dayLabel {
    const labels = {
      'monday': 'Lunes',
      'tuesday': 'Martes',
      'wednesday': 'Miércoles',
      'thursday': 'Jueves',
      'friday': 'Viernes',
      'saturday': 'Sábado',
      'sunday': 'Domingo',
    };
    return labels[dayOfWeek.toLowerCase()] ?? dayOfWeek;
  }
}
