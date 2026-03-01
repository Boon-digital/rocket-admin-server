// API request/response types (local copy — server package has no dependency on rocket-admin-config)

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  [key: string]: unknown;
}

export interface PaginatedRequest extends PaginationParams, SortParams, FilterParams {}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
