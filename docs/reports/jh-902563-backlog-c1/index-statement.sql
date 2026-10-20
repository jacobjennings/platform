CREATE INDEX IF NOT EXISTS activity_workspace_collection_id ON activity ("workspaceId", (data#>>'{collection}'), _id) STORING (_class)
