/// Modelo para notificaciones push y en-app
enum NotificationType {
  swapRequest,        // Nueva solicitud de cambio
  swapApproved,       // Solicitud aprobada
  swapRejected,       // Solicitud rechazada
  scheduleUpdated,    // Horario actualizado
  reminder,           // Recordatorio general
  announcement,       // Anuncio del admin
}

class AppNotification {
  final String id;
  final String userId;
  final String title;
  final String body;
  final NotificationType type;
  final Map<String, dynamic>? data; // Datos adicionales (ej: swapRequestId)
  final DateTime createdAt;
  final bool isRead;
  
  const AppNotification({
    required this.id,
    required this.userId,
    required this.title,
    required this.body,
    required this.type,
    this.data,
    required this.createdAt,
    this.isRead = false,
  });
  
  factory AppNotification.fromMap(Map<String, dynamic> map, String id) {
    return AppNotification(
      id: id,
      userId: map['userId'] ?? '',
      title: map['title'] ?? '',
      body: map['body'] ?? '',
      type: NotificationType.values.firstWhere(
        (e) => e.name == map['type'],
        orElse: () => NotificationType.announcement,
      ),
      data: map['data'] as Map<String, dynamic>?,
      createdAt: DateTime.parse(map['createdAt']),
      isRead: map['isRead'] ?? false,
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'userId': userId,
      'title': title,
      'body': body,
      'type': type.name,
      'data': data,
      'createdAt': createdAt.toIso8601String(),
      'isRead': isRead,
    };
  }
  
  AppNotification markAsRead() {
    return AppNotification(
      id: id,
      userId: userId,
      title: title,
      body: body,
      type: type,
      data: data,
      createdAt: createdAt,
      isRead: true,
    );
  }
}
