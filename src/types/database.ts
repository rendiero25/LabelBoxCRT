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
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          box_id: string
          created_at: string
          id: string
          layer_name: string
          layer_no: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          box_id: string
          created_at?: string
          id?: string
          layer_name: string
          layer_no: number
          sort_order: number
          updated_at?: string
        }
        Update: {
          box_id?: string
          created_at?: string
          id?: string
          layer_name?: string
          layer_no?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "box_layers_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
        ]
      }
      boxes: {
        Row: {
          box_code: string
          box_name: string
          box_no: number
          created_at: string
          id: string
          master_item_id: string
          updated_at: string
        }
        Insert: {
          box_code: string
          box_name: string
          box_no: number
          created_at?: string
          id?: string
          master_item_id: string
          updated_at?: string
        }
        Update: {
          box_code?: string
          box_name?: string
          box_no?: number
          created_at?: string
          id?: string
          master_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boxes_master_item_id_fkey"
            columns: ["master_item_id"]
            isOneToOne: false
            referencedRelation: "master_items"
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
      label_box_batches: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          delivery_date_snapshot: string
          delivery_number_id: string
          delivery_number_snapshot: string
          id: string
          item_code_snapshot: string
          label_count: number
          lot_no: string
          master_item_id: string
          master_item_row_no: number
          packing_date: string
          packing_qty: number
          part_no_snapshot: string
          qr_generated_at: string | null
          qty_delivery: number
          qty_delivery_display: number | null
          supplier_code_snapshot: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by: string
          delivery_date_snapshot: string
          delivery_number_id: string
          delivery_number_snapshot: string
          id?: string
          item_code_snapshot: string
          label_count: number
          lot_no: string
          master_item_id: string
          master_item_row_no: number
          packing_date: string
          packing_qty: number
          part_no_snapshot: string
          qr_generated_at?: string | null
          qty_delivery: number
          qty_delivery_display?: number | null
          supplier_code_snapshot: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          delivery_date_snapshot?: string
          delivery_number_id?: string
          delivery_number_snapshot?: string
          id?: string
          item_code_snapshot?: string
          label_count?: number
          lot_no?: string
          master_item_id?: string
          master_item_row_no?: number
          packing_date?: string
          packing_qty?: number
          part_no_snapshot?: string
          qr_generated_at?: string | null
          qty_delivery?: number
          qty_delivery_display?: number | null
          supplier_code_snapshot?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_box_batches_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_box_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_box_batches_delivery_number_id_fkey"
            columns: ["delivery_number_id"]
            isOneToOne: false
            referencedRelation: "delivery_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_box_batches_master_item_id_fkey"
            columns: ["master_item_id"]
            isOneToOne: false
            referencedRelation: "master_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_box_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      label_boxes: {
        Row: {
          batch_id: string
          box_id: string
          box_no: number
          box_number: string
          created_at: string
          id: string
          packing_session_id: string | null
          qr_payload: string
          set_no: number
          status: Database["public"]["Enums"]["label_box_status"]
        }
        Insert: {
          batch_id: string
          box_id: string
          box_no: number
          box_number: string
          created_at?: string
          id?: string
          packing_session_id?: string | null
          qr_payload: string
          set_no: number
          status?: Database["public"]["Enums"]["label_box_status"]
        }
        Update: {
          batch_id?: string
          box_id?: string
          box_no?: number
          box_number?: string
          created_at?: string
          id?: string
          packing_session_id?: string | null
          qr_payload?: string
          set_no?: number
          status?: Database["public"]["Enums"]["label_box_status"]
        }
        Relationships: [
          {
            foreignKeyName: "label_boxes_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "label_box_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_boxes_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_boxes_packing_session_id_fkey"
            columns: ["packing_session_id"]
            isOneToOne: false
            referencedRelation: "packing_sessions"
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
          part_name: string
          part_no: string
          supplier_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_label_qty?: number
          id?: string
          is_active?: boolean
          item_code: string
          part_name: string
          part_no: string
          supplier_id?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_label_qty?: number
          id?: string
          is_active?: boolean
          item_code?: string
          part_name?: string
          part_no?: string
          supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_session_scans: {
        Row: {
          box_layer_id: string | null
          correlation_id: string
          error_code: string | null
          id: string
          label_box_batch_id: string | null
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
        }
        Insert: {
          box_layer_id?: string | null
          correlation_id?: string
          error_code?: string | null
          id?: string
          label_box_batch_id?: string | null
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
        }
        Update: {
          box_layer_id?: string | null
          correlation_id?: string
          error_code?: string | null
          id?: string
          label_box_batch_id?: string | null
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
            foreignKeyName: "packing_session_scans_label_box_batch_id_fkey"
            columns: ["label_box_batch_id"]
            isOneToOne: false
            referencedRelation: "label_box_batches"
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
        ]
      }
      packing_sessions: {
        Row: {
          box_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivery_number_id: string | null
          finalized_at: string | null
          id: string
          lot_no: string | null
          master_item_id: string
          operator_id: string
          qty_delivery: number | null
          ready_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["packing_session_status"]
          updated_at: string
        }
        Insert: {
          box_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivery_number_id?: string | null
          finalized_at?: string | null
          id?: string
          lot_no?: string | null
          master_item_id: string
          operator_id: string
          qty_delivery?: number | null
          ready_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["packing_session_status"]
          updated_at?: string
        }
        Update: {
          box_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivery_number_id?: string | null
          finalized_at?: string | null
          id?: string
          lot_no?: string | null
          master_item_id?: string
          operator_id?: string
          qty_delivery?: number | null
          ready_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["packing_session_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_sessions_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "boxes"
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
        }
        Relationships: [
          {
            foreignKeyName: "print_attempts_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
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
          lot_no_snapshot: string | null
          packing_date_snapshot: string
          packing_session_id: string
          parent_print_job_id: string | null
          part_name_snapshot: string
          part_no_snapshot: string
          qr_generated_at_snapshot: string | null
          qr_payload_snapshot: string | null
          qty_delivery_snapshot: number | null
          qty_snapshot: number
          sent_at: string | null
          sequence_no: number
          status: Database["public"]["Enums"]["print_job_status"]
          supplier_code_snapshot: string
          supplier_name_snapshot: string
          template_version: string
          updated_at: string
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
          lot_no_snapshot?: string | null
          packing_date_snapshot: string
          packing_session_id: string
          parent_print_job_id?: string | null
          part_name_snapshot: string
          part_no_snapshot: string
          qr_generated_at_snapshot?: string | null
          qr_payload_snapshot?: string | null
          qty_delivery_snapshot?: number | null
          qty_snapshot: number
          sent_at?: string | null
          sequence_no: number
          status?: Database["public"]["Enums"]["print_job_status"]
          supplier_code_snapshot: string
          supplier_name_snapshot: string
          template_version: string
          updated_at?: string
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
          lot_no_snapshot?: string | null
          packing_date_snapshot?: string
          packing_session_id?: string
          parent_print_job_id?: string | null
          part_name_snapshot?: string
          part_no_snapshot?: string
          qr_generated_at_snapshot?: string | null
          qr_payload_snapshot?: string | null
          qty_delivery_snapshot?: number | null
          qty_snapshot?: number
          sent_at?: string | null
          sequence_no?: number
          status?: Database["public"]["Enums"]["print_job_status"]
          supplier_code_snapshot?: string
          supplier_name_snapshot?: string
          template_version?: string
          updated_at?: string
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
          part_type: string | null
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
          part_type?: string | null
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
          part_type?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_label_box_scan: {
        Args: {
          p_batch_id: string
          p_label_uid: string
          p_normalized_size: string
          p_raw_payload_hash: string
          p_scanned_size: string
        }
        Returns: {
          box_number: string
          error_code: string
          label_box_id: string
          label_box_status: Database["public"]["Enums"]["label_box_status"]
          layer_accepted_qty: number
          layer_expected_qty: number
          result: Database["public"]["Enums"]["scan_result"]
          total_accepted_qty: number
          total_expected_qty: number
        }[]
      }
      accept_packing_scan: {
        Args: {
          p_label_uid: string
          p_normalized_size: string
          p_packing_session_id: string
          p_raw_payload_hash: string
          p_scanned_size: string
        }
        Returns: {
          box_layer_id: string
          error_code: string
          layer_accepted_qty: number
          layer_expected_qty: number
          product_id: string
          ready_at: string
          result: Database["public"]["Enums"]["scan_result"]
          session_id: string
          session_status: Database["public"]["Enums"]["packing_session_status"]
          total_accepted_qty: number
          total_expected_qty: number
        }[]
      }
      claim_print_job: {
        Args: { p_print_job_id: string; p_zpl_payload: string }
        Returns: {
          attempt_count: number
          job_status: Database["public"]["Enums"]["print_job_status"]
          label_reference: string
          packing_session_id: string
          print_job_id: string
          session_status: Database["public"]["Enums"]["packing_session_status"]
        }[]
      }
      close_label_box_batch: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          closed_at: string
          label_count: number
          verified_count: number
        }[]
      }
      close_or_cancel_delivery_number: {
        Args: {
          p_delivery_number_id: string
          p_status: Database["public"]["Enums"]["delivery_status"]
        }
        Returns: undefined
      }
      complete_print_job: {
        Args: {
          p_error_code?: string
          p_error_message_safe?: string
          p_print_job_id: string
          p_printer_name: string
          p_result: Database["public"]["Enums"]["print_attempt_result"]
        }
        Returns: {
          attempt_no: number
          job_status: Database["public"]["Enums"]["print_job_status"]
          label_reference: string
          packing_session_id: string
          print_job_id: string
          session_status: Database["public"]["Enums"]["packing_session_status"]
        }[]
      }
      create_box_layer: {
        Args: { p_box_id: string }
        Returns: {
          box_id: string
          id: string
          layer_name: string
          layer_no: number
          sort_order: number
        }[]
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
      create_label_box_batch: {
        Args: {
          p_delivery_date: string
          p_delivery_number: string
          p_lot_no: string
          p_master_item_id: string
          p_packing_date: string
          p_qty_delivery: number
          p_qty_delivery_display?: number
          p_supplier_id: string
        }
        Returns: {
          batch_id: string
          delivery_date: string
          delivery_number: string
          item_code: string
          label_count: number
          lot_no: string
          master_item_row_no: number
          packing_date: string
          packing_qty: number
          qr_generated_at: string
          qty_delivery: number
          qty_delivery_display: number
          supplier_code: string
        }[]
      }
      create_label_box_print_jobs: {
        Args: { p_batch_id: string }
        Returns: {
          box_name: string
          box_number: string
          delivery_date: string
          delivery_number: string
          label_box_id: string
          label_reference: string
          lot_no: string
          master_item_row_no: number
          packing_date: string
          part_name: string
          part_no: string
          print_job_id: string
          qr_payload: string
          qty: number
          qty_delivery: number
          qty_delivery_display: number
          status: Database["public"]["Enums"]["print_job_status"]
          supplier_code: string
          supplier_name: string
        }[]
      }
      create_label_box_reprint_jobs: {
        Args: { p_batch_id: string; p_label_box_ids?: string[] }
        Returns: {
          box_name: string
          box_number: string
          delivery_date: string
          delivery_number: string
          label_box_id: string
          label_reference: string
          lot_no: string
          master_item_row_no: number
          packing_date: string
          part_name: string
          part_no: string
          print_job_id: string
          qr_payload: string
          qty: number
          qty_delivery: number
          qty_delivery_display: number
          status: Database["public"]["Enums"]["print_job_status"]
          supplier_code: string
          supplier_name: string
        }[]
      }
      create_master_item: {
        Args: {
          p_default_label_qty: number
          p_item_code?: string
          p_part_name: string
          p_part_no: string
          p_supplier_id?: string
          p_unit: string
        }
        Returns: {
          created_at: string
          default_label_qty: number
          id: string
          is_active: boolean
          item_code: string
          part_name: string
          part_no: string
          supplier_id: string
          unit: string
          updated_at: string
        }[]
      }
      create_master_item_box: {
        Args: { p_master_item_id: string }
        Returns: {
          box_code: string
          box_name: string
          box_no: number
          id: string
          master_item_id: string
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
          p_part_type: string
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
          part_type: string
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
      delete_box_layer: { Args: { p_box_layer_id: string }; Returns: undefined }
      delete_label_box_batch: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          deleted_label_count: number
          deleted_print_job_count: number
          deleted_scan_count: number
        }[]
      }
      delete_master_item: {
        Args: { p_master_item_id: string }
        Returns: undefined
      }
      delete_master_item_box: { Args: { p_box_id: string }; Returns: undefined }
      delete_product: { Args: { p_product_id: string }; Returns: undefined }
      import_csv_master_data: {
        Args: { p_correlation_id: string; p_rows: Json; p_template: string }
        Returns: number
      }
      preview_csv_import: {
        Args: { p_rows: Json; p_template: string }
        Returns: {
          errors: string[]
          row_number: number
        }[]
      }
      save_box_layer_requirements: {
        Args: { p_box_layer_id: string; p_requirements: Json }
        Returns: undefined
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
      update_label_box_batch: {
        Args: {
          p_batch_id: string
          p_delivery_date: string
          p_delivery_number: string
          p_lot_no: string
          p_packing_date: string
        }
        Returns: {
          batch_id: string
          delivery_date: string
          delivery_number: string
          label_count: number
          lot_no: string
          packing_date: string
        }[]
      }
      update_master_item: {
        Args: {
          p_default_label_qty: number
          p_master_item_id: string
          p_part_name: string
          p_part_no: string
          p_supplier_id?: string
          p_unit: string
        }
        Returns: {
          created_at: string
          default_label_qty: number
          id: string
          is_active: boolean
          item_code: string
          part_name: string
          part_no: string
          supplier_id: string
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
          p_part_type: string
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
          part_type: string
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
    }
    Enums: {
      delivery_status: "draft" | "active" | "closed" | "cancelled"
      label_box_status: "generated" | "verified"
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
      user_role: "admin" | "user"
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
      label_box_status: ["generated", "verified"],
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
      user_role: ["admin", "user"],
    },
  },
} as const
