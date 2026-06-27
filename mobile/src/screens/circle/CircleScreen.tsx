import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  TrustedContact,
  getContacts,
  searchContacts,
} from '../../services/CircleService';
import SuccessToast from '../../components/SuccessToast';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import DeleteContactSheet from './DeleteContactSheet';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

// ── Avatar palette ─────────────────────────────────────────────────────────────

const AVATAR_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: '#E6F1FB', text: '#0C447C' },
  { bg: '#EAF3DE', text: '#27500A' },
  { bg: '#EEEDFE', text: '#3C3489' },
  { bg: '#FAEEDA', text: '#633806' },
  { bg: '#E1F5EE', text: '#085041' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)} *** ${phone.slice(-3)}`;
}

function avatarFor(index: number): { bg: string; text: string } {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

// ── CircleScreen ──────────────────────────────────────────────────────────────

interface ToastState {
  visible: boolean;
  title: string;
  subtitle: string;
}

const CircleScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [filtered, setFiltered] = useState<TrustedContact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [selectedContact, setSelectedContact] = useState<TrustedContact | null>(null);

  const [toast, setToast] = useState<ToastState>({
    visible: false,
    title: '',
    subtitle: '',
  });

  // ── Data ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    const data = await getContacts();
    setContacts(data);
    setFiltered(query.trim() ? searchContacts(query, data) : data);
  }, [query]);

  useEffect(() => {
    getContacts().then((data) => {
      setContacts(data);
      setFiltered(data);
      setLoading(false);
    });
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = (text: string) => {
    setQuery(text);
    setFiltered(searchContacts(text, contacts));
  };

  // ── Toast helper ──────────────────────────────────────────────────────────

  const showToast = (title: string, subtitle = '') => {
    setToast({ visible: true, title, subtitle });
  };

  // ── Contact actions ───────────────────────────────────────────────────────

  const handleContactSaved = async (contact: TrustedContact) => {
    setShowAddModal(false);
    await reload();
    showToast(
      `${contact.name} added to your circle`,
      'SMS sent · They know they\'re watching over you',
    );
  };

  const handleContactUpdated = async (contact: TrustedContact) => {
    setShowEditModal(false);
    setSelectedContact(null);
    await reload();
    showToast(`${contact.name} updated`);
  };

  const handleContactDeleted = async (contactId: string) => {
    const name = contacts.find((c) => c.id === contactId)?.name ?? 'Contact';
    setShowDeleteSheet(false);
    setSelectedContact(null);
    await reload();
    showToast(`${name} removed from your circle`);
  };

  const openEdit = (contact: TrustedContact) => {
    setSelectedContact(contact);
    setShowEditModal(true);
  };

  const openDelete = (contact: TrustedContact) => {
    setSelectedContact(contact);
    setShowDeleteSheet(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.brand.primary} />
      </View>
    );
  }

  const isSearching = query.trim().length > 0;
  const hasContacts = contacts.length > 0;
  const noResults = isSearching && filtered.length === 0 && hasContacts;
  const isEmpty = !hasContacts;

  return (
    <View style={styles.root}>
      {/* ── Toast ── */}
      <SuccessToast
        visible={toast.visible}
        title={toast.title}
        subtitle={toast.subtitle}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Your circle</Text>
          <Text style={styles.headerSubtitle}>
            {contacts.length === 1
              ? '1 person travels with you'
              : `${contacts.length} people travel with you`}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
          onPress={() => setShowAddModal(true)}
          hitSlop={8}
        >
          <Feather name="plus" size={20} color={colors.white} />
        </Pressable>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchBar}>
        <View style={styles.searchInner}>
          <Feather name="search" size={15} color="#9C9A92" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={handleSearch}
            placeholder="Search your circle…"
            placeholderTextColor="#B0AFA8"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => handleSearch('')} hitSlop={8}>
              <Feather name="x" size={15} color="#9C9A92" />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Body ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 80 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isEmpty ? (
          /* ── Empty state ── */
          <View style={styles.emptyState}>
            <View style={styles.emptyIconRing}>
              <Feather name="users" size={32} color={colors.brand.primary} />
            </View>
            <Text style={styles.emptyTitle}>Your circle is empty</Text>
            <Text style={styles.emptySub}>
              Add the people who travel with you in spirit.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.emptyBtn, pressed && styles.emptyBtnPressed]}
              onPress={() => setShowAddModal(true)}
            >
              <Text style={styles.emptyBtnText}>Add your first contact</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Section count label */}
            <Text style={styles.sectionLabel}>
              {isSearching
                ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
                : `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
            </Text>

            {noResults ? (
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>
                  No results for "{query}"
                </Text>
              </View>
            ) : (
              filtered.map((contact, index) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  index={index}
                  onEdit={() => openEdit(contact)}
                  onDelete={() => openDelete(contact)}
                />
              ))
            )}

            {/* Add card */}
            <Pressable
              style={({ pressed }) => [styles.addCard, pressed && styles.addCardPressed]}
              onPress={() => setShowAddModal(true)}
            >
              <View style={styles.addCardIcon}>
                <Feather name="user-plus" size={18} color={colors.brand.primary} />
              </View>
              <Text style={styles.addCardText}>Add someone to your circle</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* ── Bottom tab bar ── */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabItem icon="home" label="Home" onPress={() => navigation.navigate('Home')} />
        <TabItem icon="map" label="Routes" onPress={() => navigation.navigate('Routes')} />
        <TabItem icon="users" label="Circle" active />
        <TabItem icon="settings" label="Settings" onPress={() => navigation.navigate('Settings')} />
      </View>

      {/* ── Modals ── */}
      {showAddModal && (
        <AddContactModal
          visible={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSaved={handleContactSaved}
        />
      )}

      {showEditModal && selectedContact && (
        <EditContactModal
          visible={showEditModal}
          contact={selectedContact}
          onClose={() => { setShowEditModal(false); setSelectedContact(null); }}
          onUpdated={handleContactUpdated}
        />
      )}

      {showDeleteSheet && selectedContact && (
        <DeleteContactSheet
          visible={showDeleteSheet}
          contact={selectedContact}
          onClose={() => { setShowDeleteSheet(false); setSelectedContact(null); }}
          onDeleted={handleContactDeleted}
        />
      )}
    </View>
  );
};

// ── Contact card ──────────────────────────────────────────────────────────────

interface ContactCardProps {
  contact: TrustedContact;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}

const ContactCard = ({ contact, index, onEdit, onDelete }: ContactCardProps) => {
  const palette = avatarFor(index);
  return (
    <View style={styles.card}>
      <View style={[styles.avatar, { backgroundColor: palette.bg }]}>
        <Text style={[styles.avatarText, { color: palette.text }]}>
          {initials(contact.name)}
        </Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
        <Text style={styles.contactMeta} numberOfLines={1}>
          {contact.relationship}  ·  {maskPhone(contact.phone)}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.editBtn, pressed && styles.actionBtnPressed]}
        onPress={onEdit}
        hitSlop={4}
      >
        <Feather name="edit-2" size={14} color={colors.brand.primary} />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && styles.actionBtnPressed]}
        onPress={onDelete}
        hitSlop={4}
      >
        <Feather name="trash-2" size={14} color={colors.brand.sos} />
      </Pressable>
    </View>
  );
};

// ── Tab item ──────────────────────────────────────────────────────────────────

interface TabItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  onPress?: () => void;
}

const TabItem = ({ icon, label, active = false, onPress }: TabItemProps) => (
  <Pressable style={styles.tabItem} onPress={onPress} disabled={active}>
    <Feather
      name={icon}
      size={22}
      color={active ? colors.brand.primary : colors.brand.textSecondary}
    />
    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    {active && <View style={styles.tabActiveDot} />}
  </Pressable>
);

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.brand.bgSurface,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  headerLeft: { flex: 1 },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.brand.textSecondary,
    marginTop: 2,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnPressed: { opacity: 0.8 },

  // ── Search ──
  searchBar: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: spacing.gap12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand.bgSurface,
    borderRadius: 12,
    paddingHorizontal: spacing.gap12,
    height: 40,
  },
  searchIcon: { marginRight: spacing.gap8 },
  searchInput: {
    flex: 1,
    fontSize: fontSizes.caption,
    color: colors.brand.textPrimary,
    height: '100%',
  },

  // ── Scroll body ──
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.gap16,
    gap: spacing.gap8,
  },
  sectionLabel: {
    fontSize: fontSizes.small,
    fontWeight: '700',
    color: colors.brand.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  // ── Contact card ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.07)',
    paddingVertical: 10,
    paddingHorizontal: spacing.gap12,
    gap: spacing.gap12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
  },
  cardBody: { flex: 1 },
  contactName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand.textPrimary,
  },
  contactMeta: {
    fontSize: 11,
    color: colors.brand.textSecondary,
    marginTop: 2,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  actionBtnPressed: { opacity: 0.65 },
  editBtn: { backgroundColor: colors.brand.light },
  deleteBtn: { backgroundColor: '#FDEDEC' },

  // ── Add card ──
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#C6E8D5',
    paddingVertical: 14,
    paddingHorizontal: spacing.gap16,
    gap: spacing.gap12,
    marginTop: 4,
  },
  addCardPressed: { opacity: 0.7 },
  addCardIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand.primary,
  },

  // ── Empty & no-results ──
  emptyState: {
    alignItems: 'center',
    paddingTop: spacing.gap32,
    paddingBottom: spacing.gap32,
    paddingHorizontal: spacing.gap16,
  },
  emptyIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap20,
  },
  emptyTitle: {
    fontSize: fontSizes.subheading,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    marginBottom: spacing.gap8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.gap24,
  },
  emptyBtn: {
    height: spacing.buttonHeight,
    paddingHorizontal: spacing.gap32,
    backgroundColor: colors.brand.primary,
    borderRadius: spacing.borderRadius,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyBtnPressed: { opacity: 0.85 },
  emptyBtnText: {
    color: colors.white,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  noResults: { paddingVertical: spacing.gap24, alignItems: 'center' },
  noResultsText: {
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
  },

  // ── Tab bar ──
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0,0,0,0.07)',
    paddingTop: spacing.gap8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    position: 'relative',
  },
  tabLabel: {
    fontSize: fontSizes.small,
    color: colors.brand.textSecondary,
  },
  tabLabelActive: {
    color: colors.brand.primary,
    fontWeight: '600',
  },
  tabActiveDot: {
    position: 'absolute',
    bottom: -6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brand.primary,
  },

});

export default CircleScreen;
