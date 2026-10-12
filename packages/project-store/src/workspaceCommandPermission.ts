/** One public command category shared by service and interface admission. Server
 * authentication, actual membership and administrator authority remain separate. */
export type WorkspaceMutationPermission = "field:write" | "catalog:write" | "catalog:archive";
const catalog = new Set(["create_client", "update_client", "create_project_with_initial_design", "create_project_with_initial_field_map", "create_project_record",
  "rename_project", "move_project_to_client", "rename_field_map", "create_field_map_record", "create_design_record", "start_project_work", "declare_work_crs"]);
const destructive = new Set(["delete_client", "delete_project", "delete_design", "archive_and_delete_design"]);
export function workspaceCommandPermission(commandType: string): WorkspaceMutationPermission {
  return destructive.has(commandType) ? "catalog:archive" : catalog.has(commandType) ? "catalog:write" : "field:write";
}
