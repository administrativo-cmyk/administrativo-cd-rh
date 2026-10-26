export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type MonitoringDatabase={public:{Tables:Record<never,never>;Views:Record<never,never>;Enums:Record<never,never>;CompositeTypes:Record<never,never>;Functions:{
 monitoring_query:{Args:{p_action:string;p_data?:Json};Returns:Json};
 monitoring_setting_change:{Args:{p_action:string;p_data:Json};Returns:Json};
 monitoring_identity_photo:{Args:{p_source_id:string;p_identity_value:string;p_variant?:string};Returns:Json};
 monitoring_ingest:{Args:{p_data:Json};Returns:Json};
 monitoring_photo_storage:{Args:{p_action:string;p_data:Json};Returns:Json};
 monitoring_worker_sources:{Args:{p_ids:string[]};Returns:Json};
 monitoring_save_result:{Args:{p_data:Json};Returns:Json};
 monitoring_worker:{Args:{p_action:string;p_data:Json};Returns:Json};
 monitoring_cloud_worker:{Args:{p_action:string;p_data:Json};Returns:Json};
}}};
