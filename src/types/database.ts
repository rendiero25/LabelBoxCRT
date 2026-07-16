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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          correlation_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
          workstation_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          correlation_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
          workstation_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          correlation_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
          workstation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_workstation_id_fkey"
            columns: ["workstation_id"]
            isOneToOne: false
            referencedRelation: "workstations"
            referencedColumns: ["id"]
          },
        ]
      }
      box_definitions: {
        Row: {
          box_code: string
          box_name: string
          created_at: string
          id: string
          is_active: boolean
          master_item_id: string
          updated_at: string
          version: number
        }
        Insert: {
          box_code: string
          box_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          master_item_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          box_code?: string
          box_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          master_item_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "box_definitions_master_item_id_fkey"
            columns: ["master_item_id"]
            isOneToOne: false
            referencedRelation: "master_items"
            referencedColumns: ["id"]
          },
        ]
      }
      box_layer_requirements: {
        Row: {
          box_layer_id: string
          created_at: string
          expected_qty: number
          id: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          box_layer_id: string
          created_at?: string
          expected_qty: number
          id?: string
          product_id: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          box_layer_id?: string
          created_at?: string
          expected_qty?: number
          id?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_layer_requirements_box_layer_id_fkey"
            columns: ["box_layer_id"]
            isOneToOne: false
            referencedRelation: "box_layers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "box_layer_requirements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      box_layers: {
        Row: {
          box_definition_id: string
          created_at: string
          id: string
          is_active: boolean
          layer_name: string
          layer_no: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          box_definition_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          layer_name: string
          layer_no: number
          sort_order: number
          updated_at?: string
        }
        Update: {
          box_definition_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          layer_name?: string
          layer_no?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_layers_box_definition_id_fkey"
            columns: ["box_definition_id"]
            isOneToOne: false
            referencedRelation: "box_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_numbers: {
        Row: {
          created_at: string
          created_by: string
          delivery_date: string
          delivery_number: string
          id: string
          status: Database["public"]["Enums"]["delivery_status"]
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          delivery_date: string
          delivery_number: string
          id?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          delivery_date?: string
          delivery_number?: string
          id?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_numbers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_numbers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      master_item_products: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          master_item_id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          master_item_id: string
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          master_item_id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_item_products_master_item_id_fkey"
            columns: ["master_item_id"]
            isOneToOne: false
            referencedRelation: "master_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_item_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      master_items: {
        Row: {
          created_at: string
          default_label_qty: number
          id: string
          is_active: boolean
          item_code: string
          item_sequence_code: string | null
          part_name: string
          part_no: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_label_qty?: number
          id?: string
          is_active?: boolean
          item_code: string
          item_sequence_code?: string | null
          part_name: string
          part_no: string
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_label_qty?: number
          id?: string
          is_active?: boolean
          item_code?: string
          item_sequence_code?: string | null
          part_name?: string
          part_no?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      packing_session_scans: {
        Row: {
          box_layer_id: string | null
          correlation_id: string
          error_code: string | null
          id: string
          label_uid: string | null
          normalized_size: string
          packing_session_id: string
          product_id: string | null
          raw_payload_hash: string
          result: Database["public"]["Enums"]["scan_result"]
          scanned_at: string
          scanned_by: string
          scanned_part_no: string
          scanned_size: string
          workstation_id: string
        }
        Insert: {
          box_layer_id?: string | null
          correlation_id?: string
          error_code?: string | null
          id?: string
          label_uid?: string | null
          normalized_size: string
          packing_session_id: string
          product_id?: string | null
          raw_payload_hash: string
          result: Database["public"]["Enums"]["scan_result"]
          scanned_at?: string
          scanned_by: string
          scanned_part_no: string
          scanned_size: string
          workstation_id: string
        }
        Update: {
          box_layer_id?: string | null
          correlation_id?: string
          error_code?: string | null
          id?: string
          label_uid?: string | null
          normalized_size?: string
          packing_session_id?: string
          product_id?: string | null
          raw_payload_hash?: string
          result?: Database["public"]["Enums"]["scan_result"]
          scanned_at?: string
          scanned_by?: string
          scanned_part_no?: string
          scanned_size?: string
          workstation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_session_scans_box_layer_id_fkey"
            columns: ["box_layer_id"]
            isOneToOne: false
            referencedRelation: "box_layers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_session_scans_packing_session_id_fkey"
            columns: ["packing_session_id"]
            isOneToOne: false
            referencedRelation: "packing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_session_scans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_session_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_session_scans_workstation_id_fkey"
            columns: ["workstation_id"]
            isOneToOne: false
            referencedRelation: "workstations"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_sessions: {
        Row: {
          box_definition_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivery_number_id: string | null
          finalized_at: string | null
          id: string
          master_item_id: string
          operator_id: string
          ready_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["packing_session_status"]
          updated_at: string
          version: number
          workstation_id: string
        }
        Insert: {
          box_definition_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivery_number_id?: string | null
          finalized_at?: string | null
          id?: string
          master_item_id: string
          operator_id: string
          ready_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["packing_session_status"]
          updated_at?: string
          version?: number
          workstation_id: string
        }
        Update: {
          box_definition_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivery_number_id?: string | null
          finalized_at?: string | null
          id?: string
          master_item_id?: string
          operator_id?: string
          ready_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["packing_session_status"]
          updated_at?: string
          version?: number
          workstation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_sessions_box_definition_id_fkey"
            columns: ["box_definition_id"]
            isOneToOne: false
            referencedRelation: "box_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_sessions_delivery_number_id_fkey"
            columns: ["delivery_number_id"]
            isOneToOne: false
            referencedRelation: "delivery_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_sessions_master_item_id_fkey"
            columns: ["master_item_id"]
            isOneToOne: false
            referencedRelation: "master_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_sessions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_sessions_workstation_id_fkey"
            columns: ["workstation_id"]
            isOneToOne: false
            referencedRelation: "workstations"
            referencedColumns: ["id"]
          },
        ]
      }
      print_attempts: {
        Row: {
          attempt_no: number
          created_at: string
          error_code: string | null
          error_message_safe: string | null
          id: string
          print_job_id: string
          printer_name: string
          result: Database["public"]["Enums"]["print_attempt_result"]
          workstation_id: string
        }
        Insert: {
          attempt_no: number
          created_at?: string
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          print_job_id: string
          printer_name: string
          result: Database["public"]["Enums"]["print_attempt_result"]
          workstation_id: string
        }
        Update: {
          attempt_no?: number
          created_at?: string
          error_code?: string | null
          error_message_safe?: string | null
          id?: string
          print_job_id?: string
          printer_name?: string
          result?: Database["public"]["Enums"]["print_attempt_result"]
          workstation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_attempts_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_attempts_workstation_id_fkey"
            columns: ["workstation_id"]
            isOneToOne: false
            referencedRelation: "workstations"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          attempt_count: number
          box_code_snapshot: string
          box_name_snapshot: string
          confirmed_at: string | null
          created_at: string
          created_by: string
          delivery_date_snapshot: string
          delivery_number_snapshot: string
          id: string
          label_reference: string
          packing_session_id: string
          parent_print_job_id: string | null
          part_name_snapshot: string
          part_no_snapshot: string
          qty_snapshot: number
          sent_at: string | null
          sequence_no: number
          status: Database["public"]["Enums"]["print_job_status"]
          supplier_code_snapshot: string
          supplier_name_snapshot: string
          template_version: string
          updated_at: string
          workstation_id: string
          zpl_payload: string
        }
        Insert: {
          attempt_count?: number
          box_code_snapshot: string
          box_name_snapshot: string
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          delivery_date_snapshot: string
          delivery_number_snapshot: string
          id?: string
          label_reference: string
          packing_session_id: string
          parent_print_job_id?: string | null
          part_name_snapshot: string
          part_no_snapshot: string
          qty_snapshot: number
          sent_at?: string | null
          sequence_no: number
          status?: Database["public"]["Enums"]["print_job_status"]
          supplier_code_snapshot: string
          supplier_name_snapshot: string
          template_version: string
          updated_at?: string
          workstation_id: string
          zpl_payload: string
        }
        Update: {
          attempt_count?: number
          box_code_snapshot?: string
          box_name_snapshot?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          delivery_date_snapshot?: string
          delivery_number_snapshot?: string
          id?: string
          label_reference?: string
          packing_session_id?: string
          parent_print_job_id?: string | null
          part_name_snapshot?: string
          part_no_snapshot?: string
          qty_snapshot?: number
          sent_at?: string | null
          sequence_no?: number
          status?: Database["public"]["Enums"]["print_job_status"]
          supplier_code_snapshot?: string
          supplier_name_snapshot?: string
          template_version?: string
          updated_at?: string
          workstation_id?: string
          zpl_payload?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_packing_session_id_fkey"
            columns: ["packing_session_id"]
            isOneToOne: false
            referencedRelation: "packing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_parent_print_job_id_fkey"
            columns: ["parent_print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_workstation_id_fkey"
            columns: ["workstation_id"]
            isOneToOne: false
            referencedRelation: "workstations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          id: string
          inner_diameter: number
          is_active: boolean
          length: number
          normalized_dimensions: string | null
          outer_diameter: number
          part_name: string
          product_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inner_diameter: number
          is_active?: boolean
          length: number
          normalized_dimensions?: string | null
          outer_diameter: number
          part_name: string
          product_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inner_diameter?: number
          is_active?: boolean
          length?: number
          normalized_dimensions?: string | null
          outer_diameter?: number
          part_name?: string
          product_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          is_active?: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      reprint_requests: {
        Row: {
          created_at: string
          id: string
          reason: string
          requested_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_print_job_id: string
          status: Database["public"]["Enums"]["reprint_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          requested_by: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_print_job_id: string
          status?: Database["public"]["Enums"]["reprint_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          requested_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_print_job_id?: string
          status?: Database["public"]["Enums"]["reprint_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reprint_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reprint_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reprint_requests_source_print_job_id_fkey"
            columns: ["source_print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_counters: {
        Row: {
          current_value: number
          scope_key: string
          updated_at: string
        }
        Insert: {
          current_value?: number
          scope_key: string
          updated_at?: string
        }
        Update: {
          current_value?: number
          scope_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          supplier_code: string
          supplier_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          supplier_code: string
          supplier_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          supplier_code?: string
          supplier_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      workstation_assignments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          operator_id: string
          updated_at: string
          workstation_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          operator_id: string
          updated_at?: string
          workstation_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          operator_id?: string
          updated_at?: string
          workstation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstation_assignments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstation_assignments_workstation_id_fkey"
            columns: ["workstation_id"]
            isOneToOne: false
            referencedRelation: "workstations"
            referencedColumns: ["id"]
          },
        ]
      }
      workstations: {
        Row: {
          approval_status: Database["public"]["Enums"]["workstation_approval_status"]
          approved_at: string | null
          approved_by: string | null
          created_at: string
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          name: string
          printer_model: string
          printer_name: string | null
          scanner_model: string
          updated_at: string
          workstation_code: string
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["workstation_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          name: string
          printer_model?: string
          printer_name?: string | null
          scanner_model?: string
          updated_at?: string
          workstation_code: string
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["workstation_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          name?: string
          printer_model?: string
          printer_name?: string | null
          scanner_model?: string
          updated_at?: string
          workstation_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstations_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_workstation: {
        Args: { p_workstation_id: string }
        Returns: undefined
      }
      clone_box_definition_version: {
        Args: { p_box_definition_id: string }
        Returns: string
      }
      close_or_cancel_delivery_number: {
        Args: {
          p_delivery_number_id: string
          p_status: Database["public"]["Enums"]["delivery_status"]
        }
        Returns: undefined
      }
      create_box_definition: {
        Args: {
          p_box_code: string
          p_box_name: string
          p_layers: Json
          p_master_item_id: string
        }
        Returns: string
      }
      create_delivery_number: {
        Args: {
          p_delivery_date: string
          p_delivery_number: string
          p_status?: Database["public"]["Enums"]["delivery_status"]
          p_supplier_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          delivery_date: string
          delivery_number: string
          id: string
          status: Database["public"]["Enums"]["delivery_status"]
          supplier_id: string
          updated_at: string
        }[]
      }
      create_master_item: {
        Args: {
          p_default_label_qty: number
          p_item_code: string
          p_item_sequence_code?: string
          p_part_name: string
          p_part_no: string
          p_unit: string
        }
        Returns: {
          created_at: string
          default_label_qty: number
          id: string
          is_active: boolean
          item_code: string
          item_sequence_code: string
          part_name: string
          part_no: string
          unit: string
          updated_at: string
        }[]
      }
      create_master_item_product_mapping: {
        Args: { p_master_item_id: string; p_product_id: string }
        Returns: undefined
      }
      create_product: {
        Args: {
          p_inner_diameter: number
          p_length: number
          p_outer_diameter: number
          p_part_name: string
        }
        Returns: {
          created_at: string
          id: string
          inner_diameter: number
          is_active: boolean
          length: number
          normalized_dimensions: string
          outer_diameter: number
          part_name: string
          product_code: string
          updated_at: string
        }[]
      }
      create_supplier: {
        Args: { p_supplier_code: string; p_supplier_name: string }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          supplier_code: string
          supplier_name: string
          updated_at: string
        }[]
      }
      disable_workstation: {
        Args: { p_reason: string; p_workstation_id: string }
        Returns: undefined
      }
      enroll_workstation: {
        Args: { p_enrollment_code: string }
        Returns: {
          device_token: string
          workstation_id: string
        }[]
      }
      list_workstations_for_admin: {
        Args: never
        Returns: {
          approval_status: Database["public"]["Enums"]["workstation_approval_status"]
          assigned_operator_id: string
          has_active_device: boolean
          id: string
          is_active: boolean
          last_seen_at: string
          name: string
          printer_model: string
          printer_name: string
          scanner_model: string
          workstation_code: string
        }[]
      }
      publish_box_definition: {
        Args: { p_box_definition_id: string }
        Returns: string
      }
      register_workstation: {
        Args: {
          p_name: string
          p_operator_id: string
          p_printer_model: string
          p_printer_name: string
          p_scanner_model: string
          p_workstation_code: string
        }
        Returns: {
          enrollment_code: string
          enrollment_expires_at: string
          workstation_id: string
        }[]
      }
      set_master_item_active: {
        Args: { p_is_active: boolean; p_master_item_id: string }
        Returns: undefined
      }
      set_master_item_product_active: {
        Args: { p_is_active: boolean; p_mapping_id: string }
        Returns: undefined
      }
      set_product_active: {
        Args: { p_is_active: boolean; p_product_id: string }
        Returns: undefined
      }
      set_supplier_active: {
        Args: { p_is_active: boolean; p_supplier_id: string }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          supplier_code: string
          supplier_name: string
          updated_at: string
        }[]
      }
      update_box_definition: {
        Args: {
          p_box_code: string
          p_box_definition_id: string
          p_box_name: string
          p_layers: Json
        }
        Returns: string
      }
      update_delivery_number: {
        Args: {
          p_delivery_date: string
          p_delivery_number: string
          p_delivery_number_id: string
          p_supplier_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          delivery_date: string
          delivery_number: string
          id: string
          status: Database["public"]["Enums"]["delivery_status"]
          supplier_id: string
          updated_at: string
        }[]
      }
      update_master_item: {
        Args: {
          p_default_label_qty: number
          p_item_code: string
          p_item_sequence_code?: string
          p_master_item_id: string
          p_part_name: string
          p_part_no: string
          p_unit: string
        }
        Returns: {
          created_at: string
          default_label_qty: number
          id: string
          is_active: boolean
          item_code: string
          item_sequence_code: string
          part_name: string
          part_no: string
          unit: string
          updated_at: string
        }[]
      }
      update_product: {
        Args: {
          p_inner_diameter: number
          p_length: number
          p_outer_diameter: number
          p_part_name: string
          p_product_code: string
          p_product_id: string
        }
        Returns: {
          created_at: string
          id: string
          inner_diameter: number
          is_active: boolean
          length: number
          normalized_dimensions: string
          outer_diameter: number
          part_name: string
          product_code: string
          updated_at: string
        }[]
      }
      update_supplier: {
        Args: {
          p_supplier_code: string
          p_supplier_id: string
          p_supplier_name: string
        }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          supplier_code: string
          supplier_name: string
          updated_at: string
        }[]
      }
      workstation_heartbeat: {
        Args: { p_device_token_hash: string }
        Returns: {
          printer_model: string
          printer_name: string
          scanner_model: string
          workstation_code: string
          workstation_id: string
        }[]
      }
    }
    Enums: {
      delivery_status: "draft" | "active" | "closed" | "cancelled"
      packing_session_status:
        | "draft"
        | "scanning"
        | "ready_to_finalize"
        | "finalizing"
        | "print_pending"
        | "printing"
        | "sent_to_printer"
        | "confirmed"
        | "print_failed"
        | "cancelled"
        | "expired"
      print_attempt_result: "sent" | "failed"
      print_job_status:
        | "pending"
        | "printing"
        | "sent"
        | "confirmed"
        | "failed"
        | "cancelled"
      reprint_status: "requested" | "approved" | "rejected" | "executed"
      scan_result: "accepted" | "invalid" | "duplicate" | "over_qty"
      user_role: "admin" | "operator"
      workstation_approval_status: "pending" | "approved" | "disabled"
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
      delivery_status: ["draft", "active", "closed", "cancelled"],
      packing_session_status: [
        "draft",
        "scanning",
        "ready_to_finalize",
        "finalizing",
        "print_pending",
        "printing",
        "sent_to_printer",
        "confirmed",
        "print_failed",
        "cancelled",
        "expired",
      ],
      print_attempt_result: ["sent", "failed"],
      print_job_status: [
        "pending",
        "printing",
        "sent",
        "confirmed",
        "failed",
        "cancelled",
      ],
      reprint_status: ["requested", "approved", "rejected", "executed"],
      scan_result: ["accepted", "invalid", "duplicate", "over_qty"],
      user_role: ["admin", "operator"],
      workstation_approval_status: ["pending", "approved", "disabled"],
    },
  },
} as const
