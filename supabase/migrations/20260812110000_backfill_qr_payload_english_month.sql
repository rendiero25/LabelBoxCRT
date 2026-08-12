-- Backfill existing label_boxes and print_jobs qr_payload data from Indonesian month abbreviations to English month abbreviations.

update public.label_boxes
set qr_payload = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(qr_payload, '-AGS-', '-AUG-', 'g'),
      '-MEI-', '-MAY-', 'g'
    ),
    '-OKT-', '-OCT-', 'g'
  ),
  '-DES-', '-DEC-', 'g'
)
where qr_payload ~ '-(AGS|MEI|OKT|DES)-';

update public.print_jobs
set qr_payload_snapshot = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(qr_payload_snapshot, '-AGS-', '-AUG-', 'g'),
      '-MEI-', '-MAY-', 'g'
    ),
    '-OKT-', '-OCT-', 'g'
  ),
  '-DES-', '-DEC-', 'g'
)
where qr_payload_snapshot ~ '-(AGS|MEI|OKT|DES)-';
