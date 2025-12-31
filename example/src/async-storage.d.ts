declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    clear(): Promise<void>;
    getAllKeys(): Promise<string[]>;
    multiGet(keys: string[]): Promise<[string, string | null][]>;
    multiSet(keyValuePairs: [string, string][]): Promise<void>;
  };

  export default AsyncStorage;
}


