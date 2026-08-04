import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  TrustedContact,
  getContacts,
  searchContacts,
} from '../../services/CircleService';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import DeleteContactSheet from './DeleteContactSheet';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';
import HadinLogo from '../../components/HadinLogo';

const MAX_CIRCLE_SIZE = 10;
const SCREEN_WIDTH = Dimensions.get('window').width;

// ── Avatar palette ─────────────────────────────────────────────────────────────

const AVATAR_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: '#4B0082', text: colors.white },
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

type CircleRoute = RouteProp<AppStackParamList, 'Circle'>;

const CircleScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<CircleRoute>();

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [filtered, setFiltered] = useState<TrustedContact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [capError, setCapError] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [selectedContact, setSelectedContact] = useState<TrustedContact | null>(null);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);

  // Success modal state
  const [addedName, setAddedName] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showRemovedToast, setShowRemovedToast] = useState(false);
  const addScale = useRef(new Animated.Value(1)).current;

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

  // Auto-open add modal when navigated from dashboard
  useEffect(() => {
    if (!loading && route.params?.openAddModal) {
      tryOpenAddModal();
    }
    // Only run once after loading completes and param is present
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = (text: string) => {
    setQuery(text);
    setFiltered(searchContacts(text, contacts));
  };

  // ── Member cap guard ──────────────────────────────────────────────────────

  const tryOpenAddModal = () => {
    if (contacts.length >= MAX_CIRCLE_SIZE) {
      setCapError(true);
      return;
    }
    setCapError(false);
    setShowAddModal(true);
  };

  const animateAdd = (toValue: number) => {
    Animated.spring(addScale, {
      toValue,
      useNativeDriver: true,
      speed: 26,
      bounciness: 7,
    }).start();
  };

  // ── Contact actions ───────────────────────────────────────────────────────

  const handleContactSaved = async (contact: TrustedContact) => {
    setShowAddModal(false);
    await reload();
    setAddedName(contact.name);
    setShowSuccessModal(true);
  };

  const handleContactUpdated = async (_contact: TrustedContact) => {
    setShowEditModal(false);
    setSelectedContact(null);
    setActiveContactId(null);
    await reload();
  };

  const handleContactDeleted = async (contactId: string) => {
    setShowDeleteSheet(false);
    setSelectedContact(null);
    setActiveContactId(null);
    await reload();
    setCapError(false);
    setShowRemovedToast(true);
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
        <ActivityIndicator color="#4B0082" />
      </View>
    );
  }

  const isSearching = query.trim().length > 0;
  const hasContacts = contacts.length > 0;
  const noResults = isSearching && filtered.length === 0 && hasContacts;
  const isEmpty = !hasContacts && !isSearching;
  const displayContacts = filtered;

  return (
    <View style={[styles.root, isEmpty && styles.emptyRoot]}>
      {isEmpty ? (
        <View style={[styles.emptyTopBar, { paddingTop: insets.top + 18 }]}>
          <HadinLogo size={28} />
          <Text style={styles.emptyBrandTitle}>Hadin</Text>
          <Feather name="bell" size={21} color="#050505" />
        </View>
      ) : (
        <View style={[styles.topBar, { paddingTop: insets.top + 13 }]}>
          <HadinLogo size={28} />
          <Feather name="bell" size={18} color="#111827" />
        </View>
      )}

      {/* ── Header ── */}
      {!isEmpty && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Circle</Text>
          <Text style={styles.headerSubtitle}>
            Manage the trusted people who protect{'\n'}you.
          </Text>
          <Animated.View style={{ transform: [{ scale: addScale }] }}>
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
              onPress={tryOpenAddModal}
              onPressIn={() => animateAdd(0.94)}
              onPressOut={() => animateAdd(1)}
              hitSlop={8}
            >
              <Feather name="user-plus" size={16} color="#6B008F" />
              <Text style={styles.addBtnText}>Add to Circle</Text>
            </Pressable>
          </Animated.View>
        </View>
      )}

      {/* ── Member cap error ── */}
      {capError && (
        <View style={styles.capErrorBanner}>
          <Feather name="alert-circle" size={14} color="#92400E" />
          <Text style={styles.capErrorText}>
            Your circle is full (10/10). Remove a member to add someone new.
          </Text>
        </View>
      )}

      {/* ── Search bar ── */}
      {!isEmpty && (
        <View style={styles.searchBar}>
          <View style={styles.searchInner}>
          <Feather name="search" size={15} color="#9C9A92" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={handleSearch}
              placeholder="Search by name"
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
      )}

      {/* ── Body ── */}
      {isEmpty ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyOrbitWrap}>
            <View style={styles.emptyOrbitOuter} />
            <View style={styles.emptyOrbitInner} />
            <View style={[styles.emptyOrbitDot, styles.emptyOrbitDotTop]} />
            <View style={[styles.emptyOrbitDot, styles.emptyOrbitDotLeft]} />
            <View style={[styles.emptyOrbitDot, styles.emptyOrbitDotRight]} />
            <View style={styles.emptyPeopleIcon}>
              <Feather name="users" size={54} color="#C70039" />
              <Feather name="plus" size={24} color="#C70039" style={styles.emptyPlusIcon} />
            </View>
          </View>
          <Text style={styles.emptyTitle}>Your Circle is Empty</Text>
          <Text style={styles.emptySub}>
            Add trusted contacts to your safety{'\n'}network to stay connected and{'\n'}protected.
          </Text>
          <Animated.View style={[styles.emptyBtnWrap, { transform: [{ scale: addScale }] }]}>
            <Pressable
              style={({ pressed }) => [styles.emptyBtn, pressed && styles.emptyBtnPressed]}
              onPress={tryOpenAddModal}
              onPressIn={() => animateAdd(0.97)}
              onPressOut={() => animateAdd(1)}
            >
              <Feather name="user-plus" size={22} color={colors.white} />
              <Text style={styles.emptyBtnText}>Add First Member</Text>
            </Pressable>
          </Animated.View>
          <Text style={styles.emptyLimitText}>You can add up to 10 trusted contacts</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 80 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {noResults ? (
            <View style={styles.noResults}>
              <Text style={styles.noResultsText}>
                No results for "{query}"
              </Text>
            </View>
          ) : (
            displayContacts.map((contact, index) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                index={index}
                active={activeContactId === contact.id}
                onReveal={() => {
                  if (contact.user_id) {
                    setActiveContactId(contact.id);
                  }
                }}
                onClose={() => {
                  if (contact.user_id) {
                    setActiveContactId(null);
                  }
                }}
                onEdit={() => {
                  if (contact.user_id) openEdit(contact);
                }}
                onDelete={() => {
                  if (contact.user_id) openDelete(contact);
                }}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* ── Bottom tab bar ── */}
      <View style={[styles.tabBar, !isEmpty && styles.listTabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabItem icon="grid" label="Dashboard" onPress={() => navigation.navigate('Home')} />
        <TabItem icon="users" label="Circle" active />
        <TabItem icon="clock" label="History" onPress={() => navigation.navigate('Routes')} />
        <TabItem icon="user" label="Profile" onPress={() => navigation.navigate('Settings')} />
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

      {/* ── Member added success modal ── */}
      <MemberAddedModal
        visible={showSuccessModal}
        contactName={addedName}
        onDone={() => setShowSuccessModal(false)}
      />
      <RemovedToast
        visible={showRemovedToast}
        onHide={() => setShowRemovedToast(false)}
      />
    </View>
  );
};

// ── Member Added Modal ────────────────────────────────────────────────────────

interface MemberAddedModalProps {
  visible: boolean;
  contactName: string;
  onDone: () => void;
}

const MemberAddedModal = ({ visible, contactName, onDone }: MemberAddedModalProps) => (
  <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onDone}>
    <View style={maStyles.overlay}>
      <View style={maStyles.card}>
        <View style={maStyles.iconCircle}>
          <Feather name="check-circle" size={35} color="#6B008F" />
        </View>
        <Text style={maStyles.title}>Member Added Successfully</Text>
        <Text style={maStyles.body}>
          {contactName
            ? `${contactName} has been invited to join your circle and will receive a notification shortly.`
            : 'They have been invited to join your circle and will receive a notification shortly.'}
        </Text>
        <Pressable
          style={({ pressed }) => [maStyles.doneBtn, pressed && maStyles.doneBtnPressed]}
          onPress={onDone}
        >
          <Text style={maStyles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

// ── Removed toast ─────────────────────────────────────────────────────────────

interface RemovedToastProps {
  visible: boolean;
  onHide: () => void;
}

const RemovedToast = ({ visible, onHide }: RemovedToastProps) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-90)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(-90);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 22,
        bounciness: 4,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -90,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => onHide());
    }, 2600);

    return () => clearTimeout(timer);
  }, [visible, translateY, opacity, onHide]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.removedToast,
        { paddingTop: insets.top + 10, opacity, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.removedToastIcon}>
        <Feather name="check" size={15} color="#C91D1D" />
      </View>
      <Text style={styles.removedToastText}>Member successfully removed</Text>
      <Pressable style={styles.removedToastClose} onPress={onHide} hitSlop={10}>
        <Feather name="x" size={24} color={colors.white} />
      </Pressable>
    </Animated.View>
  );
};

// ── Contact card ──────────────────────────────────────────────────────────────

interface ContactCardProps {
  contact: TrustedContact;
  index: number;
  active: boolean;
  onReveal: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ACTION_WIDTH = 104;

const ContactCard = ({ contact, index, active, onReveal, onClose, onEdit, onDelete }: ContactCardProps) => {
  const palette = avatarFor(index);
  const isFamily = contact.relationship?.toLowerCase().includes('family');
  const translateX = useRef(new Animated.Value(active ? -ACTION_WIDTH : 0)).current;
  const startX = useRef(active ? -ACTION_WIDTH : 0);
  const [showActions, setShowActions] = useState(active);

  useEffect(() => {
    startX.current = active ? -ACTION_WIDTH : 0;
    if (active) setShowActions(true);
    Animated.spring(translateX, {
      toValue: startX.current,
      useNativeDriver: true,
      speed: 24,
      bounciness: 4,
    }).start(() => {
      if (!active) setShowActions(false);
    });
  }, [active, translateX]);

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderMove: (_, gesture) => {
      const next = Math.max(-ACTION_WIDTH, Math.min(0, startX.current + gesture.dx));
      setShowActions(next < -2);
      translateX.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < -26 || (active && gesture.dx < 18)) {
        onReveal();
      } else if (gesture.dx > 18) {
        onClose();
      } else {
        Animated.spring(translateX, {
          toValue: active ? -ACTION_WIDTH : 0,
          useNativeDriver: true,
          speed: 24,
          bounciness: 4,
        }).start(() => {
          if (!active) setShowActions(false);
        });
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, {
        toValue: active ? -ACTION_WIDTH : 0,
        useNativeDriver: true,
        speed: 24,
        bounciness: 4,
      }).start(() => {
        if (!active) setShowActions(false);
      });
    },
  });

  return (
    <View style={styles.cardShell}>
      {showActions ? (
        <View style={styles.cardActions}>
          <Pressable
            style={({ pressed }) => [styles.cardActionBtn, styles.cardEditAction, pressed && styles.cardActionPressed]}
            onPress={onEdit}
          >
            <Feather name="edit-2" size={15} color="#163B78" />
            <Text style={[styles.cardActionText, styles.cardEditActionText]}>EDIT</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.cardActionBtn, styles.cardDeleteAction, pressed && styles.cardActionPressed]}
            onPress={onDelete}
          >
            <Feather name="trash-2" size={15} color={colors.white} />
            <Text style={[styles.cardActionText, styles.cardDeleteActionText]}>DELETE</Text>
          </Pressable>
        </View>
      ) : null}
      <Animated.View
        style={[styles.card, showActions && styles.cardOpen, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <View style={[styles.avatar, { backgroundColor: palette.bg }]}>
          <Text style={[styles.avatarText, { color: palette.text }]}>
            {initials(contact.name)}
          </Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
          <View style={[styles.relationshipBadge, isFamily && styles.relationshipBadgeFamily]}>
            <Text style={[styles.relationshipBadgeText, isFamily && styles.relationshipBadgeTextFamily]}>
              {(contact.relationship || 'Trusted Contact').toUpperCase()}
            </Text>
          </View>
        </View>
        {index === 0 ? (
          <Feather name="more-vertical" size={18} color="#9CA3AF" />
        ) : (
          <Feather name="chevron-right" size={18} color="#9CA3AF" />
        )}
      </Animated.View>
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
      color={active ? '#6B008F' : '#4B5563'}
    />
    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    {active && <View style={styles.tabActiveDot} />}
  </Pressable>
);

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFC' },
  emptyRoot: { backgroundColor: colors.white },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F7FF',
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 27,
    paddingBottom: 39,
  },
  brandMark: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '900',
  },
  emptyTopBar: {
    minHeight: 71,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 31,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0F4',
    backgroundColor: colors.white,
  },
  emptyBrandTitle: {
    color: '#C70039',
    fontSize: 23,
    fontWeight: '900',
  },

  // ── Header ──
  header: {
    paddingHorizontal: 25,
    paddingBottom: 20,
  },
  headerLeft: { flex: 1 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 16,
    marginBottom: 23,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  addBtnText: {
    color: '#6B008F',
    fontSize: 12,
    fontWeight: '800',
  },
  addBtnPressed: { opacity: 0.8 },

  // ── Cap error ──
  capErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderBottomWidth: 0.5,
    borderBottomColor: '#FDE68A',
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: 10,
  },
  capErrorText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
  },

  // ── Search ──
  searchBar: {
    paddingHorizontal: 25,
    paddingTop: 0,
    paddingBottom: 24,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 14,
    height: 42,
    borderWidth: 1.5,
    borderColor: '#C9CDD8',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    height: '100%',
    paddingVertical: 0,
    textAlign: 'left',
    writingDirection: 'ltr',
  },

  // ── Scroll body ──
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 25,
    paddingTop: 0,
    gap: 8,
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
  cardShell: {
    minHeight: 82,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#E3E6EF',
    minHeight: 82,
    paddingVertical: 17,
    paddingHorizontal: 15,
    gap: 13,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  cardActive: {
    paddingRight: 0,
  },
  cardOpen: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  cardPressed: { opacity: 0.85 },
  avatar: {
    width: 37,
    height: 37,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: '#F3F4F6',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '800',
  },
  cardBody: { flex: 1 },
  contactName: {
    fontSize: 15,
    fontWeight: '900',
    color: '#374151',
    marginBottom: 3,
  },
  relationshipBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    backgroundColor: '#D7D7D7',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  relationshipBadgeFamily: { backgroundColor: '#6B008F' },
  relationshipBadgeText: { color: '#111827', fontSize: 8, fontWeight: '900' },
  relationshipBadgeTextFamily: { color: colors.white },
  cardActions: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    width: 104,
  },
  cardActionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  cardEditAction: {
    backgroundColor: '#8C9DFF',
  },
  cardDeleteAction: {
    backgroundColor: '#D21B1B',
    borderTopRightRadius: 7,
    borderBottomRightRadius: 7,
  },
  cardActionPressed: { opacity: 0.8 },
  cardActionText: {
    fontSize: 8,
    fontWeight: '900',
  },
  cardEditActionText: { color: '#163B78' },
  cardDeleteActionText: { color: colors.white },
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
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 21,
    paddingTop: 67,
  },
  emptyOrbitWrap: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 71,
  },
  emptyOrbitOuter: {
    position: 'absolute',
    width: 177,
    height: 177,
    borderRadius: 88.5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#F0AFC1',
  },
  emptyOrbitInner: {
    position: 'absolute',
    width: 101,
    height: 101,
    borderRadius: 50.5,
    borderWidth: 3,
    borderColor: '#F8E4EA',
  },
  emptyOrbitDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E38298',
  },
  emptyOrbitDotTop: {
    top: 29,
    left: 89,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#C70039',
  },
  emptyOrbitDotLeft: {
    left: 37,
    top: 100,
  },
  emptyOrbitDotRight: {
    right: 34,
    top: 73,
  },
  emptyPeopleIcon: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPlusIcon: {
    position: 'absolute',
    right: 3,
    top: 22,
  },
  emptyTitle: {
    fontSize: 27,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 22,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 47,
  },
  emptyBtn: {
    width: '100%',
    height: 52,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#6B008F',
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6B008F',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 7,
  },
  emptyBtnWrap: {
    width: '100%',
  },
  emptyBtnPressed: { opacity: 0.85 },
  emptyBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyLimitText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 25,
    textAlign: 'center',
  },
  noResults: { paddingVertical: spacing.gap24, alignItems: 'center' },
  noResultsText: {
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
  },

  // ── Tab bar ──
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#E8EEFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
  },
  listTabBar: {
    backgroundColor: '#E8EEFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    position: 'relative',
  },
  tabLabel: {
    fontSize: 10,
    color: '#4B5563',
  },
  tabLabelActive: {
    color: '#6B008F',
    fontWeight: '800',
  },
  tabActiveDot: {
    width: 0,
    height: 0,
  },
  removedToast: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    minHeight: 58,
    backgroundColor: '#C91D1D',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 13,
    zIndex: 10000,
    elevation: 12,
  },
  removedToastIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removedToastText: {
    flex: 1,
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  removedToastClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ── Member Added Modal styles ──────────────────────────────────────────────────

const maStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  card: {
    width: SCREEN_WIDTH - 24,
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: 4,
    paddingHorizontal: 31,
    paddingTop: 31,
    paddingBottom: 27,
    alignItems: 'center',
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 10,
    backgroundColor: '#F1E7FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    lineHeight: 25,
    marginBottom: 13,
  },
  body: {
    fontSize: 12,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 28,
  },
  doneBtn: {
    width: '100%',
    height: 48,
    borderRadius: 3,
    backgroundColor: '#6B008F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnPressed: { opacity: 0.85 },
  doneBtnText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
});

export default CircleScreen;
