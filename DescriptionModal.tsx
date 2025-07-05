import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

interface DescriptionModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (desc: string) => void;
  initialValue?: string;
}

const DescriptionModal: React.FC<DescriptionModalProps> = ({ visible, onClose, onSubmit, initialValue = '' }) => {
  const [desc, setDesc] = useState(initialValue);

  // Keep desc in sync with initialValue when modal opens
  React.useEffect(() => {
    if (visible) setDesc(initialValue);
  }, [visible, initialValue]);

  const handleSave = () => {
    onSubmit(desc);
    onClose();
  }

  const handleClose = () => {
    setDesc(initialValue);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          <Text style={styles.title}>Optional Description</Text>
          <TextInput
            style={styles.input}
            placeholder="Describe what is happening (optional)"
            value={desc}
            onChangeText={setDesc}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={handleClose}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.sendButton} onPress={handleSave}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    alignItems: 'stretch',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#d32f2f',
    alignSelf: 'center',
  },
  input: {
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 60,
    marginBottom: 20,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#eee',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#d32f2f',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default DescriptionModal;
