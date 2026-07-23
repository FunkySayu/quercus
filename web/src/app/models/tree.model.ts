export interface Tree {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  reference: string | null;
  name: string | null;
  created_at: string;
}

export interface CreateTreePayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  reference: string | null;
  name: string | null;
}
