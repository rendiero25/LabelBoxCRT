begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select has_type('public', 'user_role', 'user_role enum exists');
select enum_has_labels(
  'public',
  'user_role',
  array['admin', 'operator'],
  'user_role labels stay locked'
);
select has_type('public', 'delivery_status', 'delivery_status enum exists');
select enum_has_labels(
  'public',
  'delivery_status',
  array['draft', 'active', 'closed', 'cancelled'],
  'delivery_status labels stay locked'
);
select has_type('public', 'packing_session_status', 'packing_session_status enum exists');
select enum_has_labels(
  'public',
  'packing_session_status',
  array[
    'draft', 'scanning', 'ready_to_finalize', 'finalizing', 'print_pending',
    'printing', 'sent_to_printer', 'confirmed', 'print_failed', 'cancelled',
    'expired'
  ],
  'packing_session_status labels stay locked'
);
select has_type('public', 'scan_result', 'scan_result enum exists');
select enum_has_labels(
  'public',
  'scan_result',
  array['accepted', 'invalid', 'duplicate', 'over_qty'],
  'scan_result labels stay locked'
);
select has_type('public', 'print_job_status', 'print_job_status enum exists');
select enum_has_labels(
  'public',
  'print_job_status',
  array['pending', 'printing', 'sent', 'confirmed', 'failed', 'cancelled'],
  'print_job_status labels stay locked'
);
select has_type('public', 'print_attempt_result', 'print_attempt_result enum exists');
select enum_has_labels(
  'public',
  'print_attempt_result',
  array['sent', 'failed'],
  'print_attempt_result labels stay locked'
);
select has_type('public', 'reprint_status', 'reprint_status enum exists');
select enum_has_labels(
  'public',
  'reprint_status',
  array['requested', 'approved', 'rejected', 'executed'],
  'reprint_status labels stay locked'
);

select has_table('public', 'profiles', 'profiles exists');
select columns_are(
  'public',
  'profiles',
  array['id', 'display_name', 'role', 'is_active', 'created_at', 'updated_at'],
  'profiles columns stay locked'
);
select has_pk('public', 'profiles', 'profiles has primary key');
select has_fk('public', 'profiles', 'profiles references auth.users');

select has_table('public', 'suppliers', 'suppliers exists');
select columns_are(
  'public',
  'suppliers',
  array['id', 'supplier_code', 'supplier_name', 'is_active', 'created_at', 'updated_at'],
  'suppliers columns stay locked'
);
select has_pk('public', 'suppliers', 'suppliers has primary key');
select has_index('public', 'suppliers', 'suppliers_supplier_code_key', 'supplier code is unique');

select has_table('public', 'delivery_numbers', 'delivery_numbers exists');
select columns_are(
  'public',
  'delivery_numbers',
  array[
    'id', 'supplier_id', 'delivery_number', 'delivery_date', 'status',
    'created_by', 'created_at', 'updated_at'
  ],
  'delivery_numbers columns stay locked'
);
select has_pk('public', 'delivery_numbers', 'delivery_numbers has primary key');
select has_fk('public', 'delivery_numbers', 'delivery_numbers has foreign keys');
select has_index(
  'public',
  'delivery_numbers',
  'delivery_numbers_supplier_number_idx',
  'delivery number is unique inside supplier'
);

select has_table('public', 'products', 'products exists');
select columns_are(
  'public',
  'products',
  array[
    'id', 'product_code', 'part_name', 'outer_diameter', 'inner_diameter',
    'length', 'normalized_dimensions', 'is_active', 'created_at', 'updated_at'
  ],
  'products columns stay locked'
);
select col_type_is('public', 'products', 'outer_diameter', 'numeric', 'outer diameter is numeric');
select col_type_is('public', 'products', 'inner_diameter', 'numeric', 'inner diameter is numeric');
select col_type_is('public', 'products', 'length', 'numeric', 'length is numeric');
select col_not_null('public', 'products', 'outer_diameter', 'outer diameter is required');
select col_not_null('public', 'products', 'inner_diameter', 'inner diameter is required');
select col_not_null('public', 'products', 'length', 'length is required');
select has_index('public', 'products', 'products_product_code_key', 'product code is unique');
select has_index(
  'public',
  'products',
  'products_normalized_dimensions_idx',
  'normalized product dimensions are indexed'
);

select has_table('public', 'master_items', 'master_items exists');
select columns_are(
  'public',
  'master_items',
  array[
    'id', 'item_code', 'part_no', 'part_name', 'unit', 'default_label_qty',
    'item_sequence_code', 'is_active', 'created_at', 'updated_at'
  ],
  'master_items columns stay locked'
);
select has_index('public', 'master_items', 'master_items_item_code_key', 'item code is unique');
select has_index('public', 'master_items', 'master_items_part_no_key', 'part number is unique');

select has_table('public', 'master_item_products', 'master_item_products exists');
select columns_are(
  'public',
  'master_item_products',
  array['id', 'master_item_id', 'product_id', 'is_active', 'created_at', 'updated_at'],
  'master_item_products columns stay locked'
);
select has_index(
  'public',
  'master_item_products',
  'master_item_products_master_product_key',
  'master item product mapping is unique'
);

select has_table('public', 'boxes', 'boxes exists');
select columns_are(
  'public',
  'boxes',
  array['id', 'box_code', 'box_name', 'is_active', 'created_at', 'updated_at'],
  'boxes columns stay locked'
);
select has_index('public', 'boxes', 'boxes_box_code_key', 'box code is globally unique');

select has_table('public', 'master_item_boxes', 'master_item_boxes exists');
select columns_are(
  'public',
  'master_item_boxes',
  array[
    'id', 'master_item_id', 'box_id', 'version', 'is_active',
    'created_at', 'updated_at'
  ],
  'master_item_boxes columns stay locked'
);
select has_index(
  'public',
  'master_item_boxes',
  'master_item_boxes_item_box_version_key',
  'master item + box + version is unique'
);
select has_index(
  'public',
  'master_item_boxes',
  'master_item_boxes_one_active_idx',
  'only one version can be active per master item + box'
);

select has_table('public', 'box_layers', 'box_layers exists');
select columns_are(
  'public',
  'box_layers',
  array[
    'id', 'box_id', 'layer_no', 'layer_name', 'sort_order',
    'is_active', 'created_at', 'updated_at'
  ],
  'box_layers columns stay locked'
);
select has_index('public', 'box_layers', 'box_layers_box_layer_key', 'layer number is unique per box');
select has_index('public', 'box_layers', 'box_layers_box_sort_key', 'layer order is unique per box');

select has_table('public', 'box_layer_requirements', 'box_layer_requirements exists');
select columns_are(
  'public',
  'box_layer_requirements',
  array[
    'id', 'master_item_box_id', 'box_layer_id', 'product_id', 'expected_qty', 'sort_order',
    'created_at', 'updated_at'
  ],
  'box_layer_requirements columns stay locked'
);
select has_index(
  'public',
  'box_layer_requirements',
  'box_layer_requirements_assignment_layer_product_key',
  'layer product requirement is unique per assignment'
);
select has_index(
  'public',
  'box_layer_requirements',
  'box_layer_requirements_assignment_layer_sort_key',
  'layer requirement order is unique per assignment'
);

select has_table('public', 'packing_sessions', 'packing_sessions exists');

select has_table('public', 'packing_session_scans', 'packing_session_scans exists');
select has_index(
  'public',
  'packing_session_scans',
  'packing_session_scans_accepted_label_uid_idx',
  'accepted label UID is globally unique'
);

select has_table('public', 'sequence_counters', 'sequence_counters exists');
select columns_are(
  'public',
  'sequence_counters',
  array['scope_key', 'current_value', 'updated_at'],
  'sequence_counters columns stay locked'
);

select has_table('public', 'print_jobs', 'print_jobs exists');
select has_index(
  'public',
  'print_jobs',
  'print_jobs_one_initial_per_session_idx',
  'session has one initial print job'
);

select has_table('public', 'print_attempts', 'print_attempts exists');
select has_index(
  'public',
  'print_attempts',
  'print_attempts_job_attempt_key',
  'print attempt number is unique per job'
);

select has_table('public', 'reprint_requests', 'reprint_requests exists');
select has_index(
  'public',
  'reprint_requests',
  'reprint_requests_one_open_per_source_idx',
  'source job has one open reprint request'
);

select has_table('public', 'audit_logs', 'audit_logs exists');
select col_type_is('public', 'audit_logs', 'metadata', 'jsonb', 'audit metadata is jsonb');
select col_type_is('public', 'audit_logs', 'correlation_id', 'uuid', 'audit correlation ID is uuid');

select results_eq(
  $$
    select relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'profiles', 'suppliers', 'delivery_numbers', 'products', 'master_items',
        'master_item_products', 'boxes', 'master_item_boxes', 'box_layers',
        'box_layer_requirements',
        'packing_sessions', 'packing_session_scans', 'sequence_counters',
        'print_jobs', 'print_attempts', 'reprint_requests', 'audit_logs'
      )
    order by c.relname
  $$,
  array_fill(true, array[17]),
  'RLS is enabled on every exposed Phase 2 table'
);

select * from finish();
rollback;
