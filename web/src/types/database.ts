export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          store_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          store_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          store_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cessations: {
        Row: {
          absences: number
          cessation_date: string
          cessation_reason: string | null
          discounts: number
          extra_hours: number
          firestore_id: string | null
          holidays: number
          id: number
          is_modality_change: boolean
          join_date: string | null
          legacy_data: Json
          medical_leave_days: number
          next_modality: string | null
          night_hours: number
          performance: string | null
          previous_modality: string | null
          real_reason: string | null
          registered_at: string
          staff_id: string
          store_comment: string | null
          store_id: string
          tardiness: string | null
          updated_at: string
        }
        Insert: {
          absences?: number
          cessation_date: string
          cessation_reason?: string | null
          discounts?: number
          extra_hours?: number
          firestore_id?: string | null
          holidays?: number
          id?: never
          is_modality_change?: boolean
          join_date?: string | null
          legacy_data?: Json
          medical_leave_days?: number
          next_modality?: string | null
          night_hours?: number
          performance?: string | null
          previous_modality?: string | null
          real_reason?: string | null
          registered_at?: string
          staff_id: string
          store_comment?: string | null
          store_id: string
          tardiness?: string | null
          updated_at?: string
        }
        Update: {
          absences?: number
          cessation_date?: string
          cessation_reason?: string | null
          discounts?: number
          extra_hours?: number
          firestore_id?: string | null
          holidays?: number
          id?: never
          is_modality_change?: boolean
          join_date?: string | null
          legacy_data?: Json
          medical_leave_days?: number
          next_modality?: string | null
          night_hours?: number
          performance?: string | null
          previous_modality?: string | null
          real_reason?: string | null
          registered_at?: string
          staff_id?: string
          store_comment?: string | null
          store_id?: string
          tardiness?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cessations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cessations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      extra_hours: {
        Row: {
          activity: string | null
          created_at: string
          daily_details: Json
          duration_minutes: number
          end_time: string | null
          firestore_id: string | null
          id: number
          imported_at: string | null
          legacy_data: Json
          post_shift_minutes: number
          pre_shift_minutes: number
          segments: Json
          source: string
          source_file: string | null
          staff_id: string | null
          start_time: string | null
          store_id: string | null
          updated_at: string
          user_id: string | null
          work_date: string
        }
        Insert: {
          activity?: string | null
          created_at?: string
          daily_details?: Json
          duration_minutes?: number
          end_time?: string | null
          firestore_id?: string | null
          id?: never
          imported_at?: string | null
          legacy_data?: Json
          post_shift_minutes?: number
          pre_shift_minutes?: number
          segments?: Json
          source?: string
          source_file?: string | null
          staff_id?: string | null
          start_time?: string | null
          store_id?: string | null
          updated_at?: string
          user_id?: string | null
          work_date: string
        }
        Update: {
          activity?: string | null
          created_at?: string
          daily_details?: Json
          duration_minutes?: number
          end_time?: string | null
          firestore_id?: string | null
          id?: never
          imported_at?: string | null
          legacy_data?: Json
          post_shift_minutes?: number
          pre_shift_minutes?: number
          segments?: Json
          source?: string
          source_file?: string | null
          staff_id?: string | null
          start_time?: string | null
          store_id?: string | null
          updated_at?: string
          user_id?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "extra_hours_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extra_hours_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_daily_history: {
        Row: {
          created_at: string
          firestore_id: string | null
          hourly_data: Json
          id: number
          sales_amount: number | null
          sales_date: string
          source_data: Json
          store_id: string
          transactions: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          firestore_id?: string | null
          hourly_data?: Json
          id?: never
          sales_amount?: number | null
          sales_date: string
          source_data?: Json
          store_id: string
          transactions?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          firestore_id?: string | null
          hourly_data?: Json
          id?: never
          sales_amount?: number | null
          sales_date?: string
          source_data?: Json
          store_id?: string
          transactions?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_daily_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_hourly_history: {
        Row: {
          id: number
          participation_percentage: number | null
          sales_amount: number
          sales_daily_id: number
          sales_date: string
          sales_hour: string
          source_data: Json
          store_id: string
          transactions: number
        }
        Insert: {
          id?: never
          participation_percentage?: number | null
          sales_amount?: number
          sales_daily_id: number
          sales_date: string
          sales_hour: string
          source_data?: Json
          store_id: string
          transactions?: number
        }
        Update: {
          id?: never
          participation_percentage?: number | null
          sales_amount?: number
          sales_daily_id?: number
          sales_date?: string
          sales_hour?: string
          source_data?: Json
          store_id?: string
          transactions?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_hourly_history_sales_daily_id_fkey"
            columns: ["sales_daily_id"]
            isOneToOne: false
            referencedRelation: "sales_daily_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_hourly_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_month_configs: {
        Row: {
          created_at: string
          daily_hourly_parts: Json
          firestore_id: string | null
          id: number
          month_start: string
          monthly_data: Json
          real_sales_data: Json
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_hourly_parts?: Json
          firestore_id?: string | null
          id?: never
          month_start: string
          monthly_data?: Json
          real_sales_data?: Json
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_hourly_parts?: Json
          firestore_id?: string | null
          id?: never
          month_start?: string
          monthly_data?: Json
          real_sales_data?: Json
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_month_configs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_projection_hours: {
        Row: {
          id: number
          projected_sales: number
          projected_transactions: number | null
          projection_date: string
          projection_hour: string
          projection_id: number
        }
        Insert: {
          id?: never
          projected_sales?: number
          projected_transactions?: number | null
          projection_date: string
          projection_hour: string
          projection_id: number
        }
        Update: {
          id?: never
          projected_sales?: number
          projected_transactions?: number | null
          projection_date?: string
          projection_hour?: string
          projection_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_projection_hours_projection_id_fkey"
            columns: ["projection_id"]
            isOneToOne: false
            referencedRelation: "sales_projections"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_projection_templates: {
        Row: {
          created_at: string
          firestore_id: string | null
          id: number
          legacy_data: Json
          manual_staff_by_day: Json
          positions: Json
          requirements: Json
          sales_by_day: Json
          source_updated_at: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          manual_staff_by_day?: Json
          positions?: Json
          requirements?: Json
          sales_by_day?: Json
          source_updated_at?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          manual_staff_by_day?: Json
          positions?: Json
          requirements?: Json
          sales_by_day?: Json
          source_updated_at?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_projection_templates_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_projections: {
        Row: {
          created_at: string
          created_by: string | null
          firestore_id: string | null
          id: number
          legacy_data: Json
          source: string
          source_file: string | null
          store_id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          source?: string
          source_file?: string | null
          store_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          source?: string
          source_file?: string | null
          store_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_projections_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      official_holidays: {
        Row: {
          country_code: string
          created_at: string
          holiday_date: string
          name: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          holiday_date: string
          name: string
        }
        Update: {
          country_code?: string
          created_at?: string
          holiday_date?: string
          name?: string
        }
        Relationships: []
      }
      schedule_requests: {
        Row: {
          admin_comment: string | null
          created_at: string
          end_time: string | null
          firestore_id: string | null
          id: number
          legacy_data: Json
          reason: string | null
          requested_date: string
          reviewed_at: string | null
          reviewed_by: string | null
          shift_type: string
          staff_id: string
          start_time: string | null
          status: Database["public"]["Enums"]["request_status"]
          store_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_comment?: string | null
          created_at?: string
          end_time?: string | null
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          reason?: string | null
          requested_date: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_type: string
          staff_id: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          store_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_comment?: string | null
          created_at?: string
          end_time?: string | null
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          reason?: string | null
          requested_date?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_type?: string
          staff_id?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          store_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_shifts: {
        Row: {
          end_time: string | null
          id: number
          is_day_off: boolean
          is_holiday: boolean
          metadata: Json
          notes: string | null
          position: string | null
          schedule_week_id: number
          start_time: string | null
          work_date: string
        }
        Insert: {
          end_time?: string | null
          id?: never
          is_day_off?: boolean
          is_holiday?: boolean
          metadata?: Json
          notes?: string | null
          position?: string | null
          schedule_week_id: number
          start_time?: string | null
          work_date: string
        }
        Update: {
          end_time?: string | null
          id?: never
          is_day_off?: boolean
          is_holiday?: boolean
          metadata?: Json
          notes?: string | null
          position?: string | null
          schedule_week_id?: number
          start_time?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_shifts_schedule_week_id_fkey"
            columns: ["schedule_week_id"]
            isOneToOne: false
            referencedRelation: "schedule_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_weeks: {
        Row: {
          created_at: string
          firestore_id: string | null
          id: number
          legacy_data: Json
          staff_id: string
          store_id: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          staff_id: string
          store_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          firestore_id?: string | null
          id?: never
          legacy_data?: Json
          staff_id?: string
          store_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_weeks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_weeks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          birth_date: string | null
          cessation_date: string | null
          created_at: string
          dni: string | null
          email: string | null
          firestore_id: string | null
          first_name: string
          gender: string | null
          holiday_balance: number
          id: string
          is_trainee: boolean
          join_date: string | null
          last_evaluation_date: string | null
          last_evaluation_score: number | null
          last_name: string
          last_station_evaluated: string | null
          legacy_data: Json
          linked_at: string | null
          modality: string | null
          modality_change_date: string | null
          needs_completion: boolean
          next_modality: string | null
          pending_holidays: Json
          position: string
          position_abilities: Json
          sanitary_card_expiry: string | null
          sanitary_card_unlock: boolean
          status: Database["public"]["Enums"]["record_status"]
          store_id: string
          training_end_date: string | null
          training_scores: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          birth_date?: string | null
          cessation_date?: string | null
          created_at?: string
          dni?: string | null
          email?: string | null
          firestore_id?: string | null
          first_name: string
          gender?: string | null
          holiday_balance?: number
          id?: string
          is_trainee?: boolean
          join_date?: string | null
          last_evaluation_date?: string | null
          last_evaluation_score?: number | null
          last_name: string
          last_station_evaluated?: string | null
          legacy_data?: Json
          linked_at?: string | null
          modality?: string | null
          modality_change_date?: string | null
          needs_completion?: boolean
          next_modality?: string | null
          pending_holidays?: Json
          position?: string
          position_abilities?: Json
          sanitary_card_expiry?: string | null
          sanitary_card_unlock?: boolean
          status?: Database["public"]["Enums"]["record_status"]
          store_id: string
          training_end_date?: string | null
          training_scores?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          birth_date?: string | null
          cessation_date?: string | null
          created_at?: string
          dni?: string | null
          email?: string | null
          firestore_id?: string | null
          first_name?: string
          gender?: string | null
          holiday_balance?: number
          id?: string
          is_trainee?: boolean
          join_date?: string | null
          last_evaluation_date?: string | null
          last_evaluation_score?: number | null
          last_name?: string
          last_station_evaluated?: string | null
          legacy_data?: Json
          linked_at?: string | null
          modality?: string | null
          modality_change_date?: string | null
          needs_completion?: boolean
          next_modality?: string | null
          pending_holidays?: Json
          position?: string
          position_abilities?: Json
          sanitary_card_expiry?: string | null
          sanitary_card_unlock?: boolean
          status?: Database["public"]["Enums"]["record_status"]
          store_id?: string
          training_end_date?: string | null
          training_scores?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_skills: {
        Row: {
          acquired_at: string
          skill_code: string
          staff_id: string
          store_position_id: number | null
        }
        Insert: {
          acquired_at?: string
          skill_code: string
          staff_id: string
          store_position_id?: number | null
        }
        Update: {
          acquired_at?: string
          skill_code?: string
          staff_id?: string
          store_position_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_skills_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_skills_store_position_id_fkey"
            columns: ["store_position_id"]
            isOneToOne: false
            referencedRelation: "store_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      staffing_projection_hours: {
        Row: {
          calculated_staff: number
          calculation_inputs: Json
          id: number
          manual_staff: number | null
          required_staff: number
          sales_projection_hour_id: number
          store_position_id: number
        }
        Insert: {
          calculated_staff?: number
          calculation_inputs?: Json
          id?: never
          manual_staff?: number | null
          required_staff?: number
          sales_projection_hour_id: number
          store_position_id: number
        }
        Update: {
          calculated_staff?: number
          calculation_inputs?: Json
          id?: never
          manual_staff?: number | null
          required_staff?: number
          sales_projection_hour_id?: number
          store_position_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "staffing_projection_hours_sales_projection_hour_id_fkey"
            columns: ["sales_projection_hour_id"]
            isOneToOne: false
            referencedRelation: "sales_projection_hours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffing_projection_hours_store_position_id_fkey"
            columns: ["store_position_id"]
            isOneToOne: false
            referencedRelation: "store_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      store_configs: {
        Row: {
          config_key: string
          created_at: string
          firestore_id: string | null
          id: number
          store_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          config_key: string
          created_at?: string
          firestore_id?: string | null
          id?: never
          store_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          config_key?: string
          created_at?: string
          firestore_id?: string | null
          id?: never
          store_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "store_configs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_positioning_requirements: {
        Row: {
          created_at: string
          firestore_id: string | null
          id: number
          requirement_key: string
          requirements: Json
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          firestore_id?: string | null
          id?: never
          requirement_key: string
          requirements?: Json
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          firestore_id?: string | null
          id?: never
          requirement_key?: string
          requirements?: Json
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_positioning_requirements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_positions: {
        Row: {
          calculation_logic: string
          capacity: number | null
          code: string
          created_at: string
          display_order: number
          factor: number
          firestore_id: string | null
          fixed_staff: number | null
          id: number
          is_active: boolean
          legacy_data: Json
          name: string
          store_id: string
          ticket_average: number | null
          transactions_per_collaborator: number | null
          updated_at: string
        }
        Insert: {
          calculation_logic?: string
          capacity?: number | null
          code: string
          created_at?: string
          display_order?: number
          factor?: number
          firestore_id?: string | null
          fixed_staff?: number | null
          id?: never
          is_active?: boolean
          legacy_data?: Json
          name: string
          store_id: string
          ticket_average?: number | null
          transactions_per_collaborator?: number | null
          updated_at?: string
        }
        Update: {
          calculation_logic?: string
          capacity?: number | null
          code?: string
          created_at?: string
          display_order?: number
          factor?: number
          firestore_id?: string | null
          fixed_staff?: number | null
          id?: never
          is_active?: boolean
          legacy_data?: Json
          name?: string
          store_id?: string
          ticket_average?: number | null
          transactions_per_collaborator?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_positions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          firestore_id: string | null
          id: string
          is_active: boolean
          legacy_data: Json
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          firestore_id?: string | null
          id?: string
          is_active?: boolean
          legacy_data?: Json
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          firestore_id?: string | null
          id?: string
          is_active?: boolean
          legacy_data?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      study_schedule_blocks: {
        Row: {
          end_time: string
          id: number
          metadata: Json
          start_time: string
          study_day_id: number
        }
        Insert: {
          end_time: string
          id?: never
          metadata?: Json
          start_time: string
          study_day_id: number
        }
        Update: {
          end_time?: string
          id?: never
          metadata?: Json
          start_time?: string
          study_day_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "study_schedule_blocks_study_day_id_fkey"
            columns: ["study_day_id"]
            isOneToOne: false
            referencedRelation: "study_schedule_days"
            referencedColumns: ["id"]
          },
        ]
      }
      study_schedule_days: {
        Row: {
          id: number
          requests_day_off: boolean
          staff_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          id?: never
          requests_day_off?: boolean
          staff_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          id?: never
          requests_day_off?: boolean
          staff_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "study_schedule_days_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_evaluations: {
        Row: {
          area: string | null
          collaborator_signature_path: string | null
          created_at: string
          current_step: number | null
          evaluation_date: string
          feedback: Json
          firestore_id: string | null
          general_findings: string | null
          id: number
          is_edited: boolean
          legacy_data: Json
          responses: Json
          score: number | null
          staff_id: string
          station_code: string | null
          station_name: string | null
          status: Database["public"]["Enums"]["evaluation_status"]
          store_id: string
          trainer_id: string | null
          trainer_signature_path: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          collaborator_signature_path?: string | null
          created_at?: string
          current_step?: number | null
          evaluation_date: string
          feedback?: Json
          firestore_id?: string | null
          general_findings?: string | null
          id?: never
          is_edited?: boolean
          legacy_data?: Json
          responses?: Json
          score?: number | null
          staff_id: string
          station_code?: string | null
          station_name?: string | null
          status?: Database["public"]["Enums"]["evaluation_status"]
          store_id: string
          trainer_id?: string | null
          trainer_signature_path?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          collaborator_signature_path?: string | null
          created_at?: string
          current_step?: number | null
          evaluation_date?: string
          feedback?: Json
          firestore_id?: string | null
          general_findings?: string | null
          id?: never
          is_edited?: boolean
          legacy_data?: Json
          responses?: Json
          score?: number | null
          staff_id?: string
          station_code?: string | null
          station_name?: string | null
          status?: Database["public"]["Enums"]["evaluation_status"]
          store_id?: string
          trainer_id?: string | null
          trainer_signature_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_evaluations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_evaluations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string | null
          firebase_uid: string | null
          first_name: string | null
          id: string
          last_name: string | null
          legacy_data: Json
          registration_pending: boolean
          role: Database["public"]["Enums"]["app_role"]
          staff_profile_id: string | null
          status: Database["public"]["Enums"]["record_status"]
          store_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          firebase_uid?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          legacy_data?: Json
          registration_pending?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          staff_profile_id?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          firebase_uid?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          legacy_data?: Json
          registration_pending?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          staff_profile_id?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      worked_holidays: {
        Row: {
          balance_type: Database["public"]["Enums"]["holiday_balance_type"]
          created_at: string
          firestore_id: string | null
          holiday_date: string
          id: number
          legacy_data: Json
          name: string
          staff_id: string
          store_id: string
          user_id: string | null
        }
        Insert: {
          balance_type: Database["public"]["Enums"]["holiday_balance_type"]
          created_at?: string
          firestore_id?: string | null
          holiday_date: string
          id?: never
          legacy_data?: Json
          name: string
          staff_id: string
          store_id: string
          user_id?: string | null
        }
        Update: {
          balance_type?: Database["public"]["Enums"]["holiday_balance_type"]
          created_at?: string
          firestore_id?: string | null
          holiday_date?: string
          id?: never
          legacy_data?: Json
          name?: string
          staff_id?: string
          store_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worked_holidays_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worked_holidays_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      save_staff_cessation: {
        Args: {
          p_absences?: number
          p_cessation_date: string | null
          p_cessation_reason?: string
          p_discounts?: number
          p_extra_hours?: number
          p_holidays?: number
          p_medical_leave_days?: number
          p_night_hours?: number
          p_performance?: string
          p_real_reason?: string
          p_staff_id: string
          p_store_comment?: string | null
          p_tardiness?: string | null
        }
        Returns: undefined
      }
      save_staff_profile: {
        Args: {
          p_birth_date?: string | null
          p_dni?: string | null
          p_email?: string | null
          p_first_name?: string | null
          p_gender?: string | null
          p_is_trainee?: boolean
          p_join_date?: string | null
          p_last_name?: string | null
          p_modality?: string
          p_modality_change_date?: string | null
          p_next_modality?: string | null
          p_position?: string
          p_sanitary_card_expiry?: string | null
          p_sanitary_card_unlock?: boolean
          p_staff_id?: string | null
          p_status?: Database["public"]["Enums"]["record_status"]
          p_store_id?: string | null
          p_training_end_date?: string | null
        }
        Returns: string
      }
      save_study_schedule: {
        Args: {
          p_schedule: Json
          p_staff_id: string
        }
        Returns: undefined
      }
      save_weekly_schedules: {
        Args: {
          p_changes: Json
          p_week_start: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "superadmin" | "admin" | "trainer" | "collaborator"
      evaluation_status: "draft" | "completed"
      holiday_balance_type: "ganado" | "compensado"
      record_status: "pending" | "active" | "inactive"
      request_status: "pending" | "approved" | "rejected" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "admin", "trainer", "collaborator"],
      evaluation_status: ["draft", "completed"],
      holiday_balance_type: ["ganado", "compensado"],
      record_status: ["pending", "active", "inactive"],
      request_status: ["pending", "approved", "rejected", "cancelled"],
    },
  },
} as const
