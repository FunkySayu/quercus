export interface Tree {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  reference: string | null;
  name: string | null;
  created_at: string;
  nom_scientifique: string | null;
  nom_usage: string | null;
  origine: string | null;
  statut_uicn: string | null;
  wikipedia_url: string | null;
  description: string | null;
  continent: string | null;
}

export interface CreateTreePayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  reference: string | null;
  name: string | null;
}
