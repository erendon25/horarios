/// Modelo para solicitud de intercambio de horario entre colaboradores
enum SwapRequestStatus {
  pending,
  approved,
  rejected,
}

class SwapRequest {
  final String id;
  final String requesterId; // UID del que solicita
  final String requesterName;
  final String targetId; // UID del colaborador objetivo
  final String targetName;
  final DateTime date; // Fecha del horario a intercambiar
  final String requesterShift; // Turno del solicitante
  final String targetShift; // Turno del objetivo
  final String? position; // Posición
  final String storeId;
  final SwapRequestStatus status;
  final DateTime createdAt;
  final DateTime? respondedAt;
  final String? adminNote; // Nota del admin al aprobar/rechazar
  final String? rejectionReason;
  
  const SwapRequest({
    required this.id,
    required this.requesterId,
    required this.requesterName,
    required this.targetId,
    required this.targetName,
    required this.date,
    required this.requesterShift,
    required this.targetShift,
    this.position,
    required this.storeId,
    this.status = SwapRequestStatus.pending,
    required this.createdAt,
    this.respondedAt,
    this.adminNote,
    this.rejectionReason,
  });
  
  factory SwapRequest.fromMap(Map<String, dynamic> map, String id) {
    return SwapRequest(
      id: id,
      requesterId: map['requesterId'] ?? '',
      requesterName: map['requesterName'] ?? '',
      targetId: map['targetId'] ?? '',
      targetName: map['targetName'] ?? '',
      date: DateTime.parse(map['date']),
      requesterShift: map['requesterShift'] ?? '',
      targetShift: map['targetShift'] ?? '',
      position: map['position'],
      storeId: map['storeId'] ?? '',
      status: SwapRequestStatus.values.firstWhere(
        (e) => e.name == map['status'],
        orElse: () => SwapRequestStatus.pending,
      ),
      createdAt: DateTime.parse(map['createdAt']),
      respondedAt: map['respondedAt'] != null 
          ? DateTime.parse(map['respondedAt']) 
          : null,
      adminNote: map['adminNote'],
      rejectionReason: map['rejectionReason'],
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'requesterId': requesterId,
      'requesterName': requesterName,
      'targetId': targetId,
      'targetName': targetName,
      'date': date.toIso8601String(),
      'requesterShift': requesterShift,
      'targetShift': targetShift,
      'position': position,
      'storeId': storeId,
      'status': status.name,
      'createdAt': createdAt.toIso8601String(),
      'respondedAt': respondedAt?.toIso8601String(),
      'adminNote': adminNote,
      'rejectionReason': rejectionReason,
    };
  }
  
  bool get isPending => status == SwapRequestStatus.pending;
  bool get isApproved => status == SwapRequestStatus.approved;
  bool get isRejected => status == SwapRequestStatus.rejected;
  
  SwapRequest copyWith({
    String? id,
    String? requesterId,
    String? requesterName,
    String? targetId,
    String? targetName,
    DateTime? date,
    String? requesterShift,
    String? targetShift,
    String? position,
    String? storeId,
    SwapRequestStatus? status,
    DateTime? createdAt,
    DateTime? respondedAt,
    String? adminNote,
    String? rejectionReason,
  }) {
    return SwapRequest(
      id: id ?? this.id,
      requesterId: requesterId ?? this.requesterId,
      requesterName: requesterName ?? this.requesterName,
      targetId: targetId ?? this.targetId,
      targetName: targetName ?? this.targetName,
      date: date ?? this.date,
      requesterShift: requesterShift ?? this.requesterShift,
      targetShift: targetShift ?? this.targetShift,
      position: position ?? this.position,
      storeId: storeId ?? this.storeId,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      respondedAt: respondedAt ?? this.respondedAt,
      adminNote: adminNote ?? this.adminNote,
      rejectionReason: rejectionReason ?? this.rejectionReason,
    );
  }
}
