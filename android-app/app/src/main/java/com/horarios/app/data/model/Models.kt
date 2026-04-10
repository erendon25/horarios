package com.horarios.app.data.model

data class StaffProfile(
    val id: String = "",
    val uid: String = "",
    val name: String = "",
    val lastName: String = "",
    val email: String = "",
    val dni: String = "",
    val modality: String = "",
    val position: String = "COLABORADOR",
    val storeId: String = "",
    val storeName: String = "",
    val joinDate: String = "",
    val sanitaryCardDate: String = "",
    val skills: List<String> = emptyList(),
    val positionAbilities: List<String> = emptyList(),
    val feriados: Int = 0,
    val isTrainee: Boolean = false,
    val isTrainer: Boolean = false,
    val role: String = "collaborator" // superadmin, admin, collaborator
)

data class Store(
    val id: String = "",
    val name: String = "",
    val location: String = ""
)

data class DailySchedule(
    val start: String = "",
    val end: String = "",
    val position: String = "",
    val off: Boolean = false,
    val feriado: Boolean = false,
    val extraHours: Double = 0.0
)

data class WeeklySchedule(
    val staffId: String = "",
    val weekKey: String = "",
    val monday: DailySchedule = DailySchedule(),
    val tuesday: DailySchedule = DailySchedule(),
    val wednesday: DailySchedule = DailySchedule(),
    val thursday: DailySchedule = DailySchedule(),
    val friday: DailySchedule = DailySchedule(),
    val saturday: DailySchedule = DailySchedule(),
    val sunday: DailySchedule = DailySchedule()
)
