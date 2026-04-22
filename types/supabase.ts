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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          academic_year: string | null
          activity_id: string | null
          award_type: string | null
          category: string
          cbc_competency_area: string | null
          class_id: string | null
          competency_level: string | null
          created_at: string | null
          description: string | null
          evidence_urls: string[] | null
          id: string
          is_public: boolean | null
          issued_at: string
          issued_by: string | null
          portfolio_featured: boolean | null
          school_id: string
          shareable_with_parents: boolean | null
          skill_tags: string[] | null
          student_id: string
          term: string | null
          title: string
          updated_at: string | null
          valid_until: string | null
          verification_status: string | null
          verified_by: string | null
        }
        Insert: {
          academic_year?: string | null
          activity_id?: string | null
          award_type?: string | null
          category: string
          cbc_competency_area?: string | null
          class_id?: string | null
          competency_level?: string | null
          created_at?: string | null
          description?: string | null
          evidence_urls?: string[] | null
          id?: string
          is_public?: boolean | null
          issued_at?: string
          issued_by?: string | null
          portfolio_featured?: boolean | null
          school_id: string
          shareable_with_parents?: boolean | null
          skill_tags?: string[] | null
          student_id: string
          term?: string | null
          title: string
          updated_at?: string | null
          valid_until?: string | null
          verification_status?: string | null
          verified_by?: string | null
        }
        Update: {
          academic_year?: string | null
          activity_id?: string | null
          award_type?: string | null
          category?: string
          cbc_competency_area?: string | null
          class_id?: string | null
          competency_level?: string | null
          created_at?: string | null
          description?: string | null
          evidence_urls?: string[] | null
          id?: string
          is_public?: boolean | null
          issued_at?: string
          issued_by?: string | null
          portfolio_featured?: boolean | null
          school_id?: string
          shareable_with_parents?: boolean | null
          skill_tags?: string[] | null
          student_id?: string
          term?: string | null
          title?: string
          updated_at?: string | null
          valid_until?: string | null
          verification_status?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "achievements_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievements_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievements_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievements_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_achievements_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          audience: string | null
          capacity: number | null
          category: string
          cbc_competency_area: string | null
          created_at: string | null
          description: string | null
          end_date: string | null
          end_time: string | null
          enrollment_status: string | null
          evidence_requirements: string | null
          expires_at: string | null
          gallery_urls: string[] | null
          id: string
          image_url: string | null
          is_published: boolean | null
          location: string | null
          managing_teacher_id: string | null
          max_grade_level: string | null
          min_grade_level: string | null
          posted_by: string | null
          published_at: string | null
          school_id: string
          skill_tags: string[] | null
          start_date: string
          start_time: string | null
          target_class_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          audience?: string | null
          capacity?: number | null
          category: string
          cbc_competency_area?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          enrollment_status?: string | null
          evidence_requirements?: string | null
          expires_at?: string | null
          gallery_urls?: string[] | null
          id?: string
          image_url?: string | null
          is_published?: boolean | null
          location?: string | null
          managing_teacher_id?: string | null
          max_grade_level?: string | null
          min_grade_level?: string | null
          posted_by?: string | null
          published_at?: string | null
          school_id: string
          skill_tags?: string[] | null
          start_date: string
          start_time?: string | null
          target_class_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          audience?: string | null
          capacity?: number | null
          category?: string
          cbc_competency_area?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          enrollment_status?: string | null
          evidence_requirements?: string | null
          expires_at?: string | null
          gallery_urls?: string[] | null
          id?: string
          image_url?: string | null
          is_published?: boolean | null
          location?: string | null
          managing_teacher_id?: string | null
          max_grade_level?: string | null
          min_grade_level?: string | null
          posted_by?: string | null
          published_at?: string | null
          school_id?: string
          skill_tags?: string[] | null
          start_date?: string
          start_time?: string | null
          target_class_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_managing_teacher_id_fkey"
            columns: ["managing_teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_target_class_id_fkey"
            columns: ["target_class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_activities_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_participants: {
        Row: {
          activity_id: string
          assessed_at: string | null
          assessed_by: string | null
          certificate_issued: boolean | null
          certificate_url: string | null
          competency_rating: number | null
          created_at: string | null
          enrolled_by: string | null
          enrollment_status: string | null
          evidence_urls: string[] | null
          id: string
          joined_at: string | null
          peer_feedback: string | null
          position_awarded: string | null
          role: string | null
          school_id: string
          skills_demonstrated: string[] | null
          student_id: string
          teacher_feedback: string | null
          updated_at: string | null
        }
        Insert: {
          activity_id: string
          assessed_at?: string | null
          assessed_by?: string | null
          certificate_issued?: boolean | null
          certificate_url?: string | null
          competency_rating?: number | null
          created_at?: string | null
          enrolled_by?: string | null
          enrollment_status?: string | null
          evidence_urls?: string[] | null
          id?: string
          joined_at?: string | null
          peer_feedback?: string | null
          position_awarded?: string | null
          role?: string | null
          school_id: string
          skills_demonstrated?: string[] | null
          student_id: string
          teacher_feedback?: string | null
          updated_at?: string | null
        }
        Update: {
          activity_id?: string
          assessed_at?: string | null
          assessed_by?: string | null
          certificate_issued?: boolean | null
          certificate_url?: string | null
          competency_rating?: number | null
          created_at?: string | null
          enrolled_by?: string | null
          enrollment_status?: string | null
          evidence_urls?: string[] | null
          id?: string
          joined_at?: string | null
          peer_feedback?: string | null
          position_awarded?: string | null
          role?: string | null
          school_id?: string
          skills_demonstrated?: string[] | null
          student_id?: string
          teacher_feedback?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_participants_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_participants_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_participants_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_activity_participants_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          audience: string
          body: string
          created_at: string | null
          expires_at: string | null
          id: string
          is_pinned: boolean | null
          is_published: boolean | null
          posted_by: string | null
          priority: string | null
          published_at: string | null
          school_id: string
          target_class_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          audience: string
          body: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_pinned?: boolean | null
          is_published?: boolean | null
          posted_by?: string | null
          priority?: string | null
          published_at?: string | null
          school_id: string
          target_class_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_pinned?: boolean | null
          is_published?: boolean | null
          posted_by?: string | null
          priority?: string | null
          published_at?: string | null
          school_id?: string
          target_class_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_target_class_id_fkey"
            columns: ["target_class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_announcements_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          class_id: string
          created_at: string | null
          date: string
          id: string
          notes: string | null
          recorded_by: string | null
          school_id: string
          session_type: string
          status: string
          student_id: string
          updated_at: string | null
        }
        Insert: {
          class_id: string
          created_at?: string | null
          date: string
          id?: string
          notes?: string | null
          recorded_by?: string | null
          school_id: string
          session_type?: string
          status: string
          student_id: string
          updated_at?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string | null
          date?: string
          id?: string
          notes?: string | null
          recorded_by?: string | null
          school_id?: string
          session_type?: string
          status?: string
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_attendance_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_ip: unknown
          actor_role: string | null
          actor_user_agent: string | null
          actor_user_id: string | null
          created_at: string | null
          device_fingerprint: string | null
          id: string
          is_suspicious: boolean | null
          resource_after: Json | null
          resource_before: Json | null
          resource_id: string | null
          resource_type: string
          risk_score: number | null
          session_id: string | null
          suspicious_reasons: string[] | null
        }
        Insert: {
          action: string
          actor_ip?: unknown
          actor_role?: string | null
          actor_user_agent?: string | null
          actor_user_id?: string | null
          created_at?: string | null
          device_fingerprint?: string | null
          id?: string
          is_suspicious?: boolean | null
          resource_after?: Json | null
          resource_before?: Json | null
          resource_id?: string | null
          resource_type: string
          risk_score?: number | null
          session_id?: string | null
          suspicious_reasons?: string[] | null
        }
        Update: {
          action?: string
          actor_ip?: unknown
          actor_role?: string | null
          actor_user_agent?: string | null
          actor_user_id?: string | null
          created_at?: string | null
          device_fingerprint?: string | null
          id?: string
          is_suspicious?: boolean | null
          resource_after?: Json | null
          resource_before?: Json | null
          resource_id?: string | null
          resource_type?: string
          risk_score?: number | null
          session_id?: string | null
          suspicious_reasons?: string[] | null
        }
        Relationships: []
      }
      class_subjects: {
        Row: {
          academic_year: string
          assigned_at: string | null
          assigned_by: string | null
          assignment_status: string | null
          class_id: string
          created_at: string | null
          end_date: string | null
          id: string
          is_primary_teacher: boolean | null
          school_id: string
          sis_assignment_id: string | null
          sis_last_synced_at: string | null
          subject_id: string
          teacher_id: string
          updated_at: string | null
        }
        Insert: {
          academic_year: string
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_status?: string | null
          class_id: string
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_primary_teacher?: boolean | null
          school_id: string
          sis_assignment_id?: string | null
          sis_last_synced_at?: string | null
          subject_id: string
          teacher_id: string
          updated_at?: string | null
        }
        Update: {
          academic_year?: string
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_status?: string | null
          class_id?: string
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_primary_teacher?: boolean | null
          school_id?: string
          sis_assignment_id?: string | null
          sis_last_synced_at?: string | null
          subject_id?: string
          teacher_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_class_subjects_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year: string
          capacity: number | null
          class_teacher_id: string | null
          created_at: string | null
          grade_level: string
          id: string
          is_active: boolean | null
          name: string
          school_id: string
          sis_class_id: string | null
          sis_last_synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          academic_year: string
          capacity?: number | null
          class_teacher_id?: string | null
          created_at?: string | null
          grade_level: string
          id?: string
          is_active?: boolean | null
          name: string
          school_id: string
          sis_class_id?: string | null
          sis_last_synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_year?: string
          capacity?: number | null
          class_teacher_id?: string | null
          created_at?: string | null
          grade_level?: string
          id?: string
          is_active?: boolean | null
          name?: string
          school_id?: string
          sis_class_id?: string | null
          sis_last_synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_classes_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_classes_teacher"
            columns: ["class_teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          audience: string | null
          created_at: string | null
          description: string | null
          expires_at: string | null
          file_size_bytes: number | null
          file_type: string
          file_url: string
          id: string
          is_published: boolean | null
          mime_type: string | null
          published_at: string | null
          school_id: string
          target_class_id: string | null
          target_student_id: string | null
          title: string
          updated_at: string | null
          uploaded_by: string | null
          version: number | null
        }
        Insert: {
          audience?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          file_size_bytes?: number | null
          file_type: string
          file_url: string
          id?: string
          is_published?: boolean | null
          mime_type?: string | null
          published_at?: string | null
          school_id: string
          target_class_id?: string | null
          target_student_id?: string | null
          title: string
          updated_at?: string | null
          uploaded_by?: string | null
          version?: number | null
        }
        Update: {
          audience?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          file_size_bytes?: number | null
          file_type?: string
          file_url?: string
          id?: string
          is_published?: boolean | null
          mime_type?: string | null
          published_at?: string | null
          school_id?: string
          target_class_id?: string | null
          target_student_id?: string | null
          title?: string
          updated_at?: string | null
          uploaded_by?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_target_class_id_fkey"
            columns: ["target_class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_target_student_id_fkey"
            columns: ["target_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_documents_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_payments: {
        Row: {
          academic_year: string
          amount_due: number
          amount_paid: number | null
          balance: number | null
          created_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          posted_by: string | null
          school_id: string
          status: string | null
          student_id: string
          term: string
          transaction_reference: string | null
          updated_at: string | null
          verified_by: string | null
        }
        Insert: {
          academic_year: string
          amount_due: number
          amount_paid?: number | null
          balance?: number | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          posted_by?: string | null
          school_id: string
          status?: string | null
          student_id: string
          term: string
          transaction_reference?: string | null
          updated_at?: string | null
          verified_by?: string | null
        }
        Update: {
          academic_year?: string
          amount_due?: number
          amount_paid?: number | null
          balance?: number | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          posted_by?: string | null
          school_id?: string
          status?: string | null
          student_id?: string
          term?: string
          transaction_reference?: string | null
          updated_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fee_payments_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_methods: {
        Row: {
          authenticator_type: string | null
          contact_value: string | null
          created_at: string | null
          credential_id: string | null
          device_name: string | null
          id: string
          is_primary: boolean | null
          is_verified: boolean | null
          last_used_at: string | null
          method_type: string
          public_key: string | null
          totp_secret_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          authenticator_type?: string | null
          contact_value?: string | null
          created_at?: string | null
          credential_id?: string | null
          device_name?: string | null
          id?: string
          is_primary?: boolean | null
          is_verified?: boolean | null
          last_used_at?: string | null
          method_type: string
          public_key?: string | null
          totp_secret_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          authenticator_type?: string | null
          contact_value?: string | null
          created_at?: string | null
          credential_id?: string | null
          device_name?: string | null
          id?: string
          is_primary?: boolean | null
          is_verified?: boolean | null
          last_used_at?: string | null
          method_type?: string
          public_key?: string | null
          totp_secret_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      parent_student: {
        Row: {
          can_receive_notification: boolean | null
          can_view_attendance: boolean | null
          can_view_financial: boolean | null
          can_view_grades: boolean | null
          created_at: string | null
          emergency_contact_priority: number | null
          has_legal_custody: boolean | null
          id: string
          is_primary: boolean | null
          parent_id: string
          relationship: string
          restricted_access_reason: string | null
          school_id: string
          sis_confirmed: boolean | null
          student_id: string
          updated_at: string | null
          verification_status: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          can_receive_notification?: boolean | null
          can_view_attendance?: boolean | null
          can_view_financial?: boolean | null
          can_view_grades?: boolean | null
          created_at?: string | null
          emergency_contact_priority?: number | null
          has_legal_custody?: boolean | null
          id?: string
          is_primary?: boolean | null
          parent_id: string
          relationship: string
          restricted_access_reason?: string | null
          school_id: string
          sis_confirmed?: boolean | null
          student_id: string
          updated_at?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          can_receive_notification?: boolean | null
          can_view_attendance?: boolean | null
          can_view_financial?: boolean | null
          can_view_grades?: boolean | null
          created_at?: string | null
          emergency_contact_priority?: number | null
          has_legal_custody?: boolean | null
          id?: string
          is_primary?: boolean | null
          parent_id?: string
          relationship?: string
          restricted_access_reason?: string | null
          school_id?: string
          sis_confirmed?: boolean | null
          student_id?: string
          updated_at?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_parent_student_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_student_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_student_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      parents: {
        Row: {
          address: string | null
          created_at: string | null
          custody_documents_url: string | null
          emergency_contact_phone: string | null
          has_legal_custody: boolean | null
          id: string
          identity_document_url: string | null
          identity_verified: boolean | null
          notification_preferences: Json | null
          occupation: string | null
          preferred_language: string | null
          relationship_proof_url: string | null
          restricted_from_picking_up: boolean | null
          school_id: string
          sis_last_synced_at: string | null
          sis_parent_id: string | null
          update_at: string | null
          user_id: string
          verification_completed_at: string | null
          verification_method: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          custody_documents_url?: string | null
          emergency_contact_phone?: string | null
          has_legal_custody?: boolean | null
          id?: string
          identity_document_url?: string | null
          identity_verified?: boolean | null
          notification_preferences?: Json | null
          occupation?: string | null
          preferred_language?: string | null
          relationship_proof_url?: string | null
          restricted_from_picking_up?: boolean | null
          school_id: string
          sis_last_synced_at?: string | null
          sis_parent_id?: string | null
          update_at?: string | null
          user_id: string
          verification_completed_at?: string | null
          verification_method?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          custody_documents_url?: string | null
          emergency_contact_phone?: string | null
          has_legal_custody?: boolean | null
          id?: string
          identity_document_url?: string | null
          identity_verified?: boolean | null
          notification_preferences?: Json | null
          occupation?: string | null
          preferred_language?: string | null
          relationship_proof_url?: string | null
          restricted_from_picking_up?: boolean | null
          school_id?: string
          sis_last_synced_at?: string | null
          sis_parent_id?: string | null
          update_at?: string | null
          user_id?: string
          verification_completed_at?: string | null
          verification_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_parents_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: string | null
          avatar_url: string | null
          created_at: string | null
          failed_login_attempts: number | null
          full_name: string
          id: string
          last_login_at: string | null
          locked_until: string | null
          mfa_enabled: boolean | null
          phone: string | null
          role: string
          school_id: string
          sis_id: string | null
          sis_last_synced_at: string | null
          sis_sync_status: string | null
          updated_at: string | null
          verification_code_expires_at: string | null
          verification_code_hash: string | null
          verification_status: string | null
        }
        Insert: {
          account_status?: string | null
          avatar_url?: string | null
          created_at?: string | null
          failed_login_attempts?: number | null
          full_name: string
          id: string
          last_login_at?: string | null
          locked_until?: string | null
          mfa_enabled?: boolean | null
          phone?: string | null
          role: string
          school_id: string
          sis_id?: string | null
          sis_last_synced_at?: string | null
          sis_sync_status?: string | null
          updated_at?: string | null
          verification_code_expires_at?: string | null
          verification_code_hash?: string | null
          verification_status?: string | null
        }
        Update: {
          account_status?: string | null
          avatar_url?: string | null
          created_at?: string | null
          failed_login_attempts?: number | null
          full_name?: string
          id?: string
          last_login_at?: string | null
          locked_until?: string | null
          mfa_enabled?: boolean | null
          phone?: string | null
          role?: string
          school_id?: string
          sis_id?: string | null
          sis_last_synced_at?: string | null
          sis_sync_status?: string | null
          updated_at?: string | null
          verification_code_expires_at?: string | null
          verification_code_hash?: string | null
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_profiles_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      report_cards: {
        Row: {
          academic_year: string
          average_score: number | null
          class_id: string
          created_at: string | null
          created_by: string | null
          id: string
          is_published: boolean | null
          out_of: number | null
          position_in_class: number | null
          principal_comment: string | null
          published_at: string | null
          school_id: string
          student_id: string
          teacher_comment: string | null
          term: string
          total_score: number | null
          updated_at: string | null
        }
        Insert: {
          academic_year: string
          average_score?: number | null
          class_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_published?: boolean | null
          out_of?: number | null
          position_in_class?: number | null
          principal_comment?: string | null
          published_at?: string | null
          school_id: string
          student_id: string
          teacher_comment?: string | null
          term: string
          total_score?: number | null
          updated_at?: string | null
        }
        Update: {
          academic_year?: string
          average_score?: number | null
          class_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_published?: boolean | null
          out_of?: number | null
          position_in_class?: number | null
          principal_comment?: string | null
          published_at?: string | null
          school_id?: string
          student_id?: string
          teacher_comment?: string | null
          term?: string
          total_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_report_cards_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cards_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cards_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      results: {
        Row: {
          academic_year: string
          class_subject_id: string
          grade: string | null
          id: string
          posted_at: string | null
          posted_by: string | null
          remarks: string | null
          school_id: string
          score: number | null
          student_id: string
          term: string
          updated_at: string | null
        }
        Insert: {
          academic_year: string
          class_subject_id: string
          grade?: string | null
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          remarks?: string | null
          school_id: string
          score?: number | null
          student_id: string
          term: string
          updated_at?: string | null
        }
        Update: {
          academic_year?: string
          class_subject_id?: string
          grade?: string | null
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          remarks?: string | null
          school_id?: string
          score?: number | null
          student_id?: string
          term?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_results_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_class_subject_id_fkey"
            columns: ["class_subject_id"]
            isOneToOne: false
            referencedRelation: "class_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role: string
        }
        Insert: {
          permission: string
          role: string
        }
        Update: {
          permission?: string
          role?: string
        }
        Relationships: []
      }
      schools: {
        Row: {
          academic_calendar: Json | null
          address: string | null
          code: string
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          settings: Json | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          academic_calendar?: Json | null
          address?: string | null
          code: string
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          phone?: string | null
          settings?: Json | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_calendar?: Json | null
          address?: string | null
          code?: string
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          settings?: Json | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      security_events: {
        Row: {
          auto_response_taken: string | null
          created_at: string
          device_fingerprint: string | null
          event_data: Json | null
          event_type: string
          id: string
          ip_address: unknown
          requires_review: boolean
          resource_id: string | null
          resource_type: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_indicators: string[] | null
          severity: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          auto_response_taken?: string | null
          created_at?: string
          device_fingerprint?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          ip_address?: unknown
          requires_review?: boolean
          resource_id?: string | null
          resource_type?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_indicators?: string[] | null
          severity: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          auto_response_taken?: string | null
          created_at?: string
          device_fingerprint?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          ip_address?: unknown
          requires_review?: boolean
          resource_id?: string | null
          resource_type?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_indicators?: string[] | null
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      session_management: {
        Row: {
          created_at: string
          device_fingerprint: string | null
          device_info: Json | null
          expires_at: string
          geo_location: Json | null
          id: string
          ip_address: unknown
          is_active: boolean
          is_current_session: boolean
          last_activity_at: string
          refresh_token_hash: string | null
          session_token_hash: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_fingerprint?: string | null
          device_info?: Json | null
          expires_at: string
          geo_location?: Json | null
          id?: string
          ip_address?: unknown
          is_active?: boolean
          is_current_session?: boolean
          last_activity_at?: string
          refresh_token_hash?: string | null
          session_token_hash: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_fingerprint?: string | null
          device_info?: Json | null
          expires_at?: string
          geo_location?: Json | null
          id?: string
          ip_address?: unknown
          is_active?: boolean
          is_current_session?: boolean
          last_activity_at?: string
          refresh_token_hash?: string | null
          session_token_hash?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sis_sync_log: {
        Row: {
          completed_at: string | null
          duration_ms: number | null
          error_messages: string[] | null
          id: string
          records_created: number
          records_deleted: number
          records_failed: number
          records_processed: number
          records_updated: number
          resource_type: string
          sis_webhook_id: string | null
          started_at: string
          status: string
          sync_type: string
          triggered_by: string | null
          warnings: string[] | null
        }
        Insert: {
          completed_at?: string | null
          duration_ms?: number | null
          error_messages?: string[] | null
          id?: string
          records_created?: number
          records_deleted?: number
          records_failed?: number
          records_processed?: number
          records_updated?: number
          resource_type: string
          sis_webhook_id?: string | null
          started_at?: string
          status: string
          sync_type: string
          triggered_by?: string | null
          warnings?: string[] | null
        }
        Update: {
          completed_at?: string | null
          duration_ms?: number | null
          error_messages?: string[] | null
          id?: string
          records_created?: number
          records_deleted?: number
          records_failed?: number
          records_processed?: number
          records_updated?: number
          resource_type?: string
          sis_webhook_id?: string | null
          started_at?: string
          status?: string
          sync_type?: string
          triggered_by?: string | null
          warnings?: string[] | null
        }
        Relationships: []
      }
      students: {
        Row: {
          admission_number: string
          created_at: string | null
          current_class_id: string | null
          date_of_birth: string
          enrollment_date: string | null
          enrollment_status: string | null
          gender: string | null
          graduation_date: string | null
          id: string
          parent_verified: boolean | null
          parental_consent_date: string | null
          parental_consent_given: boolean | null
          privacy_settings: Json | null
          requires_parental_consent: boolean | null
          school_id: string
          sis_last_synced_at: string | null
          sis_student_id: string | null
          sis_verified: boolean | null
          transfer_date: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          admission_number: string
          created_at?: string | null
          current_class_id?: string | null
          date_of_birth: string
          enrollment_date?: string | null
          enrollment_status?: string | null
          gender?: string | null
          graduation_date?: string | null
          id?: string
          parent_verified?: boolean | null
          parental_consent_date?: string | null
          parental_consent_given?: boolean | null
          privacy_settings?: Json | null
          requires_parental_consent?: boolean | null
          school_id: string
          sis_last_synced_at?: string | null
          sis_student_id?: string | null
          sis_verified?: boolean | null
          transfer_date?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          admission_number?: string
          created_at?: string | null
          current_class_id?: string | null
          date_of_birth?: string
          enrollment_date?: string | null
          enrollment_status?: string | null
          gender?: string | null
          graduation_date?: string | null
          id?: string
          parent_verified?: boolean | null
          parental_consent_date?: string | null
          parental_consent_given?: boolean | null
          privacy_settings?: Json | null
          requires_parental_consent?: boolean | null
          school_id?: string
          sis_last_synced_at?: string | null
          sis_student_id?: string | null
          sis_verified?: boolean | null
          transfer_date?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_students_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_current_class_id_fkey"
            columns: ["current_class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          school_id: string
          sis_last_synced_at: string | null
          sis_subject_id: string | null
          update_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          school_id: string
          sis_last_synced_at?: string | null
          sis_subject_id?: string | null
          update_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          school_id?: string
          sis_last_synced_at?: string | null
          sis_subject_id?: string | null
          update_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_subjects_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          background_check_date: string | null
          background_check_status: string | null
          created_at: string | null
          department: string | null
          employee_number: string
          employment_end_date: string | null
          employment_start_date: string | null
          employment_status: string | null
          hr_verificaton_date: string | null
          hr_verified: boolean | null
          id: string
          is_class_teacher: boolean | null
          school_id: string
          sis_employee_id: string | null
          sis_last_synced_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          background_check_date?: string | null
          background_check_status?: string | null
          created_at?: string | null
          department?: string | null
          employee_number: string
          employment_end_date?: string | null
          employment_start_date?: string | null
          employment_status?: string | null
          hr_verificaton_date?: string | null
          hr_verified?: boolean | null
          id?: string
          is_class_teacher?: boolean | null
          school_id: string
          sis_employee_id?: string | null
          sis_last_synced_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          background_check_date?: string | null
          background_check_status?: string | null
          created_at?: string | null
          department?: string | null
          employee_number?: string
          employment_end_date?: string | null
          employment_start_date?: string | null
          employment_status?: string | null
          hr_verificaton_date?: string | null
          hr_verified?: boolean | null
          id?: string
          is_class_teacher?: boolean | null
          school_id?: string
          sis_employee_id?: string | null
          sis_last_synced_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_teachers_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      timetables: {
        Row: {
          academic_year: string
          class_id: string
          created_at: string | null
          day_of_week: string
          end_time: string
          id: string
          is_active: boolean | null
          period_name: string | null
          room_location: string | null
          school_id: string
          start_time: string
          subject_id: string
          teacher_id: string
          term: string | null
          updated_at: string | null
        }
        Insert: {
          academic_year: string
          class_id: string
          created_at?: string | null
          day_of_week: string
          end_time: string
          id?: string
          is_active?: boolean | null
          period_name?: string | null
          room_location?: string | null
          school_id: string
          start_time: string
          subject_id: string
          teacher_id: string
          term?: string | null
          updated_at?: string | null
        }
        Update: {
          academic_year?: string
          class_id?: string
          created_at?: string | null
          day_of_week?: string
          end_time?: string
          id?: string
          is_active?: boolean | null
          period_name?: string | null
          room_location?: string | null
          school_id?: string
          start_time?: string
          subject_id?: string
          teacher_id?: string
          term?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_timetables_school"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetables_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetables_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetables_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_codes: {
        Row: {
          attempts: number | null
          code_hash: string
          code_type: string
          created_at: string | null
          device_fingerprint: string | null
          email: string | null
          expires_at: string
          id: string
          ip_address: unknown
          max_attempts: number | null
          phone: string | null
          purpose: string | null
          used_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number | null
          code_hash: string
          code_type: string
          created_at?: string | null
          device_fingerprint?: string | null
          email?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown
          max_attempts?: number | null
          phone?: string | null
          purpose?: string | null
          used_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number | null
          code_hash?: string
          code_type?: string
          created_at?: string | null
          device_fingerprint?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          max_attempts?: number | null
          phone?: string | null
          purpose?: string | null
          used_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      verification_requests: {
        Row: {
          admin_notes: string | null
          created_at: string | null
          device_fingerprint: string | null
          document_urls: string[] | null
          document_verification_status: string | null
          expires_at: string | null
          id: string
          ip_address: unknown
          priority: string | null
          rejection_reason: string | null
          requested_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          risk_score: number | null
          sis_match_confidence: number | null
          status: string | null
          submitted_data: Json
          updated_at: string | null
          user_agent: string | null
          user_id: string
          verification_method: string | null
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string | null
          device_fingerprint?: string | null
          document_urls?: string[] | null
          document_verification_status?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          priority?: string | null
          rejection_reason?: string | null
          requested_role: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number | null
          sis_match_confidence?: number | null
          status?: string | null
          submitted_data: Json
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
          verification_method?: string | null
        }
        Update: {
          admin_notes?: string | null
          created_at?: string | null
          device_fingerprint?: string | null
          document_urls?: string[] | null
          document_verification_status?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          priority?: string | null
          rejection_reason?: string | null
          requested_role?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number | null
          sis_match_confidence?: number | null
          status?: string | null
          submitted_data?: Json
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
          verification_method?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_account_health: { Args: { p_user_id: string }; Returns: Json }
      get_class_daily_attendance_summary: {
        Args: {
          p_class_id: string
          p_date: string
          p_school_id: string
          p_session_type: string
        }
        Returns: {
          absent: number
          attendance_rate: number
          excused: number
          late: number
          present: number
          total: number
        }[]
      }
      get_student_attendance_summary: {
        Args: {
          p_class_id: string
          p_date_from: string
          p_date_to: string
          p_school_id: string
          p_student_id: string
        }
        Returns: {
          absent: number
          attendance_rate: number
          excused: number
          holiday: number
          late: number
          present: number
          total: number
        }[]
      }
      get_user_permissions: { Args: { p_user_id: string }; Returns: Json }
      handle_successful_login: {
        Args: {
          p_ip: unknown
          p_session_id: string
          p_user_agent: string
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
