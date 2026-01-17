/// Modelo de usuario para la aplicación
class UserModel {
  final String uid;
  final String email;
  final String role;
  final String? name;
  final String? lastName;
  final String? storeId;
  
  const UserModel({
    required this.uid,
    required this.email,
    required this.role,
    this.name,
    this.lastName,
    this.storeId,
  });
  
  factory UserModel.fromMap(Map<String, dynamic> map, String uid) {
    return UserModel(
      uid: uid,
      email: map['email'] ?? '',
      role: map['role'] ?? 'collaborator',
      name: map['name'],
      lastName: map['lastName'],
      storeId: map['storeId'],
    );
  }
  
  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'email': email,
      'role': role,
      'name': name,
      'lastName': lastName,
      'storeId': storeId,
    };
  }
  
  bool get isAdmin => role == 'admin' || role == 'superadmin';
  bool get isSuperAdmin => role == 'superadmin';
  bool get isCollaborator => role == 'collaborator';
  
  String get fullName => '${name ?? ''} ${lastName ?? ''}'.trim();
  
  UserModel copyWith({
    String? uid,
    String? email,
    String? role,
    String? name,
    String? lastName,
    String? storeId,
  }) {
    return UserModel(
      uid: uid ?? this.uid,
      email: email ?? this.email,
      role: role ?? this.role,
      name: name ?? this.name,
      lastName: lastName ?? this.lastName,
      storeId: storeId ?? this.storeId,
    );
  }
}
